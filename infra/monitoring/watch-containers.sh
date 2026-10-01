#!/bin/bash
# Surveillance interne des conteneurs (SCA-B7-08). Complète la sonde externe (UptimeRobot), qui ne
# voit que les URL publiques : ici, un crash du bot Discord, de Redis ou une boucle de redémarrages.
#
# Installé dans /opt/backups/watch-containers.sh, lancé par cron toutes les 5 min.
# Alerte par e-mail (Resend, même boîte que les alertes de l'API) UNIQUEMENT quand l'état change :
# une panne → un e-mail, son rétablissement → un e-mail. Pas de rafale toutes les 5 min.
#
# WATCH_TEST=1 ./watch-containers.sh  → envoie un e-mail de test (vérifie la chaîne d'alerte).
set -uo pipefail

ENV_PROD=/opt/apps/mytradingcoach/prod/.env.production
STATE=/opt/backups/.watch-state
RESTARTS=/opt/backups/.watch-restarts   # « conteneur compteur » du passage précédent
DISK_MAX=85
# Doivent TOUJOURS tourner. dev/beta : arrêtables volontairement (jour J), surveillés seulement s'ils tournent.
CRITICAL="mtc_api_prod mtc_postgres mtc_pgbouncer mtc_redis mtc_traefik mtc_app_prod mtc_landing_prod mtc_admin mtc_discord_bot"

problems=()
declare -A before=()
while read -r name count; do [ -n "$name" ] && before[$name]=$count; done < <(cat "$RESTARTS" 2>/dev/null)
: > "$RESTARTS.new"
for c in $(docker ps -a --format '{{.Names}}' | grep '^mtc_' | sort); do
  read -r status health oom restarts < <(docker inspect "$c" --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.State.OOMKilled}} {{.RestartCount}}')
  echo "$c $restarts" >> "$RESTARTS.new"
  critical=0; [[ " $CRITICAL " == *" $c "* ]] && critical=1
  if [ "$status" != running ]; then
    [ "$critical" = 1 ] && problems+=("$c : $status (conteneur critique arrêté)")
    continue
  fi
  [ "$health" = unhealthy ] && problems+=("$c : unhealthy")
  [ "$oom" = true ] && problems+=("$c : tué par manque de mémoire (OOM)")
  # Nouveau redémarrage par Docker depuis le passage précédent (RestartCount est cumulé depuis la
  # création ; une recréation par le CD le remet à 0, ce n'est pas une panne).
  prev=${before[$c]:-$restarts}
  [ "$restarts" -gt "$prev" ] && problems+=("$c : redémarré automatiquement ($((restarts - prev)) fois en 5 min)")
done
mv "$RESTARTS.new" "$RESTARTS"
disk=$(df --output=pcent / | tail -1 | tr -dc '0-9')
[ "$disk" -ge "$DISK_MAX" ] && problems+=("disque / : ${disk} % utilisé (seuil ${DISK_MAX} %)")

send() { # $1 sujet, $2 corps
  local key; key=$(grep -m1 '^RESEND_API_KEY=' "$ENV_PROD" | cut -d= -f2- | tr -d '"')
  SUBJECT="$1" BODY="$2" KEY="$key" python3 - <<'PY'
import json, os, urllib.error, urllib.request
req = urllib.request.Request(
    "https://api.resend.com/emails",
    data=json.dumps({
        "from": "noreply@mytradingcoach.app",
        "to": "hello@mytradingcoach.app",
        "subject": os.environ["SUBJECT"],
        "text": os.environ["BODY"],
    }).encode(),
    # User-Agent explicite : Cloudflare (devant Resend) refuse celui de Python-urllib (403).
    headers={"Authorization": "Bearer " + os.environ["KEY"], "Content-Type": "application/json",
             "User-Agent": "mtc-watch-containers/1.0"},
)
try:
    print("[watch] e-mail", urllib.request.urlopen(req, timeout=15).status)
except urllib.error.HTTPError as e:
    print("[watch] e-mail REFUSÉ", e.code, e.read().decode()[:300])
    raise SystemExit(1)
PY
}

now=$(date -u '+%d/%m/%Y %H:%M UTC')
if [ "${WATCH_DRY:-0}" = 1 ]; then
  echo "[watch] $now : ${#problems[@]} problème(s)"; printf '  %s\n' "${problems[@]:-}"; exit 0
fi
if [ "${WATCH_TEST:-0}" = 1 ]; then
  send "✅ Test supervision VPS" "Chaîne d'alerte opérationnelle ($now). État actuel : ${#problems[@]} problème(s)."
  exit 0
fi

current=$(printf '%s\n' "${problems[@]:-}" | sed '/^$/d' | sort)
previous=$(cat "$STATE" 2>/dev/null || true)
[ "$current" = "$previous" ] && exit 0   # rien de nouveau : pas d'e-mail

if [ -n "$current" ]; then
  subject="🔴 VPS MyTradingCoach : $(echo "$current" | wc -l) problème(s)"
  body="$now

$current

Diagnostic : docker ps -a · docker logs --tail 100 <conteneur> · df -h
Runbook : docs/ops/reprise-vps.md"
else
  subject="🟢 VPS MyTradingCoach : rétabli"
  body="$now — plus aucun problème détecté.

Précédemment :
$previous"
fi
# L'état n'est mémorisé qu'après un envoi réussi : sinon l'alerte serait perdue, on réessaie dans 5 min.
send "$subject" "$body" && printf '%s' "$current" > "$STATE"
