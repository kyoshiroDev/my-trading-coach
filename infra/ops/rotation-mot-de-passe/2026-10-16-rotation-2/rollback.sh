#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════════════════════════
# ARCHIVE — 2e rotation du mot de passe de mtc_user, VPS prod, 16/10/2026. MODÈLE, ne pas lancer tel quel.
# - sudo n'est plus sans mot de passe sur le VPS prod (exception de migration retirée le 17/10/2026) :
#   l'étape 0 (« sudo -n true », « sudo test », « sudo grep ») s'arrête et les écritures de
#   userlist.txt (sudo tee, chown) échouent. Prochaine fois : lancer dans un terminal où sudo a déjà
#   été validé par Greg, ou réécrire ces étapes (docker run … alpine pour userlist.txt).
# - Chemins datés (rotation-20261016*, SHA 1a67cbde987a) à adapter ; dossiers R/B à préparer à part
#   (nouveau mot de passe dans un fichier 600, .new, copies d'avant), voir docs/ops/maintenance-2026-10-17.md.
# - Aucun secret ici : les mots de passe sont lus dans des fichiers 600 et ne passent ni à l'écran ni
#   en argument de commande.
# ════════════════════════════════════════════════════════════════════════════════════════════════
# Retour arrière de la 2e rotation : remet le mot de passe d'AVANT (état de 23 h 06) partout et
# l'API sur la couleur qui était active au lancement (lue dans ./couleurs, écrit par phase2.sh).
# Appelé par phase2.sh en cas d'échec, ou à la main (avec l'accord de Greg) :
#   bash ~/rotation2/rollback.sh
# Idempotent : peut être relancé. Aucun secret affiché ni passé en argument de commande.
set -uo pipefail

B=/opt/apps/mytradingcoach/prod-secrets/env-backups/rotation-20261016-2
P=/opt/apps/mytradingcoach/prod
DB=/opt/infra/databases
HERE=$(cd "$(dirname "$0")" && pwd)
SHA=1a67cbde987a
QUIET="SET log_min_error_statement = panic; SET log_min_duration_statement = -1; SET log_statement = 'none'; SET pg_stat_statements.track_utility = off;"
log() { echo "[rollback] $(TZ=Europe/Paris date +%H:%M:%S) $*"; }
select1() {
  PGPASSWORD="$3" PGCONNECT_TIMEOUT=5 docker exec -e PGPASSWORD -e PGCONNECT_TIMEOUT mtc_postgres \
    psql -h "$1" -p "$2" -U mtc_user -d mytradingcoach_prod -Atc 'select 1' 2>/dev/null
}

# 1. Déploiement en cours (lancé par phase2.sh) : arrêt de tout son groupe de processus.
if [ -s "$HERE/deploy.pid" ]; then
  pid=$(cat "$HERE/deploy.pid")
  if kill -0 "$pid" 2>/dev/null; then
    log "arrêt de deploy-api.sh (groupe $pid)"
    kill -TERM -- "-$pid" 2>/dev/null; sleep 3; kill -KILL -- "-$pid" 2>/dev/null
  fi
  rm -f "$HERE/deploy.pid"
fi

# 2. Ancien mot de passe dans Postgres (lu dans la copie d'avant, passé sur l'entrée standard).
OLD=$(grep -m1 '^MTC_USER_PASSWORD=' "$B/databases.env" | cut -d= -f2-)
[ -n "$OLD" ] || { log "❌ ancien mot de passe introuvable dans $B/databases.env : ARRÊT, intervention manuelle"; exit 1; }
log "ALTER ROLE mtc_user → ancien mot de passe"
printf "%s\nALTER ROLE mtc_user PASSWORD '%s';\n" "$QUIET" "$OLD" \
  | docker exec -i mtc_postgres psql -U mtc_admin -d postgres -v ON_ERROR_STOP=1 -q \
  || log "❌ ALTER ROLE en échec (suite quand même : fichiers)"

# 3. Fichiers d'avant (mêmes inodes, droits conservés).
log "restauration de $DB/.env et .env.production"
cat "$B/databases.env" > "$DB/.env"
cat "$B/.env.production" > "$P/.env.production"
# userlist.txt régénéré depuis pg_authid (empreinte de l'ancien mot de passe, jamais affichée) ;
# la copie d'avant ne sert que si l'empreinte lue est inattendue.
log "userlist.txt régénéré depuis pg_authid"
SCRAM=$(docker exec mtc_postgres psql -U mtc_admin -d postgres -Atc "select rolpassword from pg_authid where rolname='mtc_user'")
case "$SCRAM" in
  SCRAM-SHA-256\$*) printf '"mtc_user" "%s"\n' "$SCRAM" | sudo tee "$DB/pgbouncer-auth/userlist.txt" >/dev/null ;;
  *) log "❌ empreinte inattendue : recopie de la copie d'avant"; sudo cp -p "$B/userlist.txt" "$DB/pgbouncer-auth/userlist.txt" ;;
esac
unset SCRAM
sudo chown 70:70 "$DB/pgbouncer-auth/userlist.txt" && sudo chmod 600 "$DB/pgbouncer-auth/userlist.txt"

# 4. PgBouncer recréé avec l'ancienne configuration (Postgres jamais touché : --no-deps).
log "recréation de PgBouncer (ancienne configuration, --no-deps)"
(cd "$DB" && docker compose -p databases up -d --no-deps pgbouncer 2>&1 | sed 's/^/    compose | /')
ok=""; for _ in $(seq 1 15); do [ "$(select1 mtc_pgbouncer 6432 "$OLD")" = 1 ] && { ok=1; break; }; sleep 1; done
[ -n "$ok" ] && log "SELECT 1 via PgBouncer (ancien mot de passe) : OK" || log "❌ SELECT 1 via PgBouncer : ÉCHEC"
[ "$(select1 mtc_postgres 5432 "$OLD")" = 1 ] && log "SELECT 1 direct (ancien mot de passe) : OK" || log "❌ SELECT 1 direct : ÉCHEC"
unset OLD

# 5. API. ACTIVE = couleur qui servait au lancement (ancien env), TARGET = couleur lancée par le
#    déploiement (nouvel env). Lues dans ./couleurs ; à défaut, on ne touche à aucune couleur.
read -r ACTIVE TARGET < "$HERE/couleurs" 2>/dev/null || { ACTIVE=""; TARGET=""; }
running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]; }
if [ -z "$ACTIVE" ]; then
  log "❌ ./couleurs absent : aucune action sur les couleurs d'API, intervention manuelle"
elif running "$ACTIVE"; then
  # Cas 1 (le seul possible en automatique) : l'active n'a pas été retirée → elle reprend seule
  # (Prisma se reconnecte avec l'ancien env qu'elle a toujours) ; la cible, au nouvel env, est retirée.
  if docker inspect "$TARGET" >/dev/null 2>&1; then
    log "suppression de $TARGET (nouvel env), $ACTIVE continue"
    docker rm -f "$TARGET" >/dev/null
  fi
else
  # Cas 2 : l'active a déjà été drainée et supprimée (déploiement allé au-delà du drain, donc retour
  # arrière lancé À LA MAIN : phase2.sh ne déclenche plus de retour arrière après « reçoit du trafic »).
  # Seule la cible tourne, avec le nouvel env que l'on vient d'invalider → redéploiement du même SHA :
  # deploy-api.sh voit la cible comme couleur active, relance l'autre couleur avec l'env restauré
  # (.env.production d'avant), attend healthy + trafic, draine la cible et recrée le worker.
  log "$ACTIVE absent : redéploiement de $SHA avec l'environnement d'avant"
  (cd "$P" && bash infra/deploy-api.sh prod "$SHA" 2>&1 | grep -E '\[deploy-api' | sed 's/^/    deploy | /')
fi
# Worker : relancé tel quel s'il est arrêté (il a l'ancien env), sinon recréé par deploy-api.sh.
if [ "$(docker inspect -f '{{.State.Running}}' mtc_api_prod_worker 2>/dev/null)" = false ]; then
  log "redémarrage du worker"; docker start mtc_api_prod_worker >/dev/null
fi

# 6. Contrôle : l'API répond de nouveau (Prisma se reconnecte tout seul).
code=""; for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' https://api.mytradingcoach.app/api/health/ready)
  [ "$code" = 200 ] && break; sleep 2
done
log "/api/health/ready : $code"
for c in mtc_api_prod_blue mtc_api_prod_green mtc_api_prod_worker mtc_pgbouncer mtc_postgres; do   # les deux couleurs : état réel
  log "   $(docker inspect -f '{{.Name}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$c" 2>&1)"
done
