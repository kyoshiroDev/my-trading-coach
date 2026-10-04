#!/usr/bin/env bash
# Déploiement de l'API sans coupure — blue/green (SCA-B8-01/03/04).
#
#   infra/deploy-api.sh <dev|prod> [<sha>]
#
# Lancé depuis la racine du dépôt cloné sur le VPS (/opt/apps/mytradingcoach/<env>), par la CD ou
# à la main. Sans <sha> : construit le commit courant. Avec <sha> : redéploie cette version ; image
# reprise si elle existe encore (retour arrière), sinon reconstruite depuis le dépôt (qui doit être
# sur ce commit).
#
# Étapes : image taguée par SHA → migration (une fois) → couleur inactive démarrée → attente
# « healthy » + vérification que Traefik lui envoie du trafic → drain de l'ancienne (unhealthy →
# Traefik la retire → arrêt) → worker (crons, files) recréé → 5 dernières images gardées.
# Un échec avant le drain arrête la nouvelle couleur : l'ancienne n'a jamais cessé de servir.
set -euo pipefail

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  dev)  COMPOSE=docker-compose.dev.yml;  ENV_FILE=.env.dev;        HOST=dev.api.mytradingcoach.app ;;
  prod) COMPOSE=docker-compose.prod.yml; ENV_FILE=.env.production; HOST=api.mytradingcoach.app ;;
  *) echo "usage: $0 <dev|prod> [<sha>]" >&2; exit 2 ;;
esac

IMAGE="mtc_api_${ENV_NAME}"
LEGACY="mtc_api_${ENV_NAME}"           # conteneur unique d'avant le blue/green (transition)
SHA="${2:-$(git rev-parse --short=12 HEAD)}"
KEEP_IMAGES=5
# Marqueur des sondes dans le journal d'accès Traefik (qui n'écrit pas le user-agent : "-").
PROBE_TAG="deploy-probe=${SHA}-$$"
export GIT_SHA="$SHA"   # → SENTRY_RELEASE (compose)

log() { echo "[deploy-api ${ENV_NAME}] $(date +%H:%M:%S) $*"; }
die() { log "❌ $*"; exit 1; }
dc() { docker compose -f "$COMPOSE" --env-file "$ENV_FILE" "$@"; }
running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]; }
health() { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1" 2>/dev/null || echo absent; }
ip_of() { docker inspect -f '{{with index .NetworkSettings.Networks "mtc_network"}}{{.IPAddress}}{{end}}' "$1"; }

# Un seul déploiement à la fois par environnement.
exec 9>"/tmp/deploy-api-${ENV_NAME}.lock"
flock -w 600 9 || die "un autre déploiement ${ENV_NAME} tourne depuis plus de 10 min"

# Backends qui ont servi les sondes de ce déploiement : journal d'accès Traefik, ligne
# « "GET /api/health?<tag> …" … "<router>" "http://<ip>:3000" ». Sondes espacées (limite anonyme
# 60/min par IP : une sonde 429 est quand même servie par un backend, donc comptée).
probe_backends() {
  local since; since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  for _ in $(seq 1 8); do
    # shellcheck disable=SC2086 # DEPLOY_CURL_OPTS : options en plus (ex. -k pour une répétition locale)
    curl -s -o /dev/null ${DEPLOY_CURL_OPTS:-} --resolve "${HOST}:443:127.0.0.1" "https://${HOST}/api/health?${PROBE_TAG}" || true
    sleep 0.2
  done
  sleep 1
  docker logs --since "$since" mtc_traefik 2>&1 | grep -F "$PROBE_TAG" \
    | grep -oE '"http://[0-9.]+:3000"' | tr -d '"' | sed 's#http://##; s#:3000##' | sort | uniq -c
}

# Retire un conteneur web du trafic AVANT de l'arrêter : /tmp/drain le rend unhealthy, Traefik le
# retire, on vérifie qu'il ne sert plus les sondes, on laisse 10 s aux requêtes en cours, on l'arrête.
# Un conteneur d'avant B8 (healthcheck sans drain) ne peut pas être retiré de Traefik avant l'arrêt :
# pendant son arrêt propre (jusqu'à 30 s), Traefik continue de lui envoyer des requêtes → 502
# (mesuré sur dev : 26 s, une requête sur deux). Il est donc arrêté vite (2 s puis SIGKILL) :
# ~2 s d'erreurs, une seule fois par environnement, à faire à une heure creuse.
drain_and_stop() {
  local c=$1 ip
  ip=$(ip_of "$c")
  log "drain de ${c} (${ip})"
  docker exec "$c" touch /tmp/drain 2>/dev/null || true
  if docker inspect -f '{{json .Config.Healthcheck.Test}}' "$c" | grep -q drain; then
    for _ in $(seq 1 30); do [ "$(health "$c")" = unhealthy ] && break; sleep 2; done
    log "${c} : $(health "$c")"
    for _ in $(seq 1 10); do
      probe_backends | grep -qw "$ip" || break
      log "Traefik sert encore ${c}, attente"; sleep 3
    done
  else
    log "⚠️ ${c} sans drain (conteneur d'avant B8) : arrêt rapide, ~2 s d'erreurs possibles"
    docker stop -t 2 "$c" >/dev/null
    docker rm "$c" >/dev/null 2>&1 || true
    return
  fi
  log "requêtes en cours : 10 s, puis arrêt de ${c}"
  sleep 10
  docker stop -t 30 "$c" >/dev/null
  docker rm "$c" >/dev/null 2>&1 || true
}

# ── 1. Image ────────────────────────────────────────────────────────────────
if docker image inspect "${IMAGE}:${SHA}" >/dev/null 2>&1; then
  log "image ${IMAGE}:${SHA} déjà présente (retour arrière ou relance) : pas de build"
else
  [ "$(git rev-parse --short=12 HEAD)" = "$SHA" ] || die "image ${SHA} absente et le dépôt n'est pas sur ce commit"
  log "build ${IMAGE}:${SHA}"
  docker build -f apps/api-mytradingcoach/Dockerfile -t "${IMAGE}:${SHA}" .
fi

# ── 2. Couleur active / cible ───────────────────────────────────────────────
ACTIVE=""
for c in blue green; do running "${IMAGE}_${c}" && ACTIVE="${ACTIVE:+$ACTIVE }$c"; done
if [ "$ACTIVE" = "blue green" ]; then
  # Déploiement précédent interrompu : on garde celle qui est saine, l'autre est la cible.
  if [ "$(health "${IMAGE}_blue")" = healthy ]; then ACTIVE=blue; else ACTIVE=green; fi
  log "⚠️ les deux couleurs tournent : on garde ${ACTIVE}"
fi
case "$ACTIVE" in
  blue)  TARGET=green; OLD="${IMAGE}_blue" ;;
  green) TARGET=blue;  OLD="${IMAGE}_green" ;;
  "")    TARGET=blue;  OLD=""; running "$LEGACY" && OLD="$LEGACY" ;;
esac
NEW="${IMAGE}_${TARGET}"
log "active : ${OLD:-aucune} → cible : ${NEW} (${SHA})"

# ── 3. Migration, une fois, avec le code de la nouvelle version ─────────────
docker tag "${IMAGE}:${SHA}" "${IMAGE}:${TARGET}"
log "migration"
# Label : Traefik ne doit jamais router vers ce conteneur éphémère.
dc run --rm --no-deps -l traefik.enable=false "api_${TARGET}" migrate

# ── 4. Nouvelle couleur ─────────────────────────────────────────────────────
abort_new() {
  log "❌ $1 — arrêt de ${NEW}, ${OLD:-aucune couleur} continue de servir. Derniers logs :"
  docker logs --tail 60 "$NEW" 2>&1 || true
  # Traefik a pu commencer à lui envoyer du trafic dès qu'il était healthy : drain, jamais d'arrêt sec.
  if running "$NEW"; then drain_and_stop "$NEW"; else docker rm -f "$NEW" >/dev/null 2>&1 || true; fi
  exit 1
}
dc up -d --no-deps --force-recreate "api_${TARGET}"
log "attente de ${NEW} healthy"
for i in $(seq 1 60); do
  h=$(health "$NEW")
  [ "$h" = healthy ] && break
  [ "$h" = unhealthy ] || ! running "$NEW" && abort_new "${NEW} ${h}"
  [ "$i" = 60 ] && abort_new "${NEW} pas healthy en 120 s"
  sleep 2
done
docker exec "$NEW" wget -qO- http://localhost:3000/api/health/ready >/dev/null 2>&1 || abort_new "${NEW} healthy mais pas prête (Postgres/Redis)"

NEW_IP=$(ip_of "$NEW")
log "vérification : Traefik envoie-t-il du trafic à ${NEW} (${NEW_IP}) ?"
seen=""
for _ in $(seq 1 10); do
  if probe_backends | grep -qw "$NEW_IP"; then seen=1; break; fi
  sleep 2
done
[ -n "$seen" ] || abort_new "Traefik n'envoie aucune requête à ${NEW}"
log "✅ ${NEW} reçoit du trafic"

# ── 5. Drain puis arrêt de l'ancienne ───────────────────────────────────────
[ -n "$OLD" ] && drain_and_stop "$OLD"

# ── 6. Worker (crons, files) : simple recréation, quelques secondes sans cron ─
docker tag "${IMAGE}:${SHA}" "${IMAGE}:worker"
dc up -d --no-deps --force-recreate worker
for i in $(seq 1 60); do
  [ "$(health "${IMAGE}_worker")" = healthy ] && break
  [ "$i" = 60 ] && die "worker pas healthy en 120 s (le web est déjà basculé et sain)"
  sleep 2
done
log "✅ worker healthy"

# ── 7. Ménage : `latest` = version en service, 5 dernières images SHA gardées ─
docker tag "${IMAGE}:${SHA}" "${IMAGE}:latest"
docker images "$IMAGE" --format '{{.CreatedAt}}|{{.Tag}}' | grep -E '\|[0-9a-f]{7,40}$' | sort -r \
  | tail -n +$((KEEP_IMAGES + 1)) | cut -d'|' -f2 \
  | while read -r tag; do docker rmi "${IMAGE}:${tag}" >/dev/null 2>&1 && log "image ${tag} supprimée" || true; done

log "✅ ${SHA} en service sur ${NEW} (+ worker). Retour arrière : $0 ${ENV_NAME} <sha> parmi :"
docker images "$IMAGE" --format '{{.Tag}}  {{.CreatedSince}}' | grep -E '^[0-9a-f]{7,40} ' | sed 's/^/  /' || true
