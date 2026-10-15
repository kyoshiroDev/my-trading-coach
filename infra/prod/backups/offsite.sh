#!/bin/bash
# Sauvegarde hors-site du VPS PROD : restic (chiffré avant envoi) → Backblaze B2, dépôt « prod »
# du bucket mtc-backups-7k3q9x (dépôt séparé de celui de l ancien VPS dev/beta).
# Cron greg 3 h 45, après backup.sh (3 h) et le nettoyage Docker (3 h 30).
# Identifiants : /opt/backups/offsite.env (600, jamais versionné). RESTIC_PASSWORD : gestionnaire de mots de passe.
#
# Usage : offsite.sh            → sauvegarde + rétention (+ vérification le dimanche)
#         offsite.sh snapshots  → liste les instantanés
#         offsite.sh restore <instantané|latest> <dossier cible>
set -euo pipefail

ENV_FILE=/opt/backups/offsite.env
BACKUPS=/opt/backups
CACHE=/opt/backups/.restic-cache
IMAGE=restic/restic:0.18.1

[ -r "$ENV_FILE" ] || { echo "[offsite] $ENV_FILE introuvable"; exit 1; }
mkdir -p "$CACHE"

run() {
  docker run --rm --env-file "$ENV_FILE" --hostname mtc-prod \
    -v "$BACKUPS":/data:ro -v /opt/infra:/infra:ro -v /opt/apps/mytradingcoach:/apps:ro \
    -v "$CACHE":/cache -e RESTIC_CACHE_DIR=/cache "$IMAGE" "$@"
}

case "${1:-backup}" in
  snapshots) run snapshots ;;
  restore)
    snap="${2:?instantané (ou latest)}"; target="${3:?dossier cible}"
    mkdir -p "$target"
    docker run --rm --env-file "$ENV_FILE" -v "$CACHE":/cache -e RESTIC_CACHE_DIR=/cache \
      -v "$(realpath "$target")":/restore "$IMAGE" restore "$snap" --target /restore
    ;;
  backup)
    echo "[offsite] début $(date -u +%FT%TZ)"
    run cat config >/dev/null 2>&1 || run init
    crontab -l > "$BACKUPS/crontab.current"
    # Dumps + tout ce qui n existe QUE sur ce VPS (configs, .env, crontab, scripts). Pas les images
    # ni le code (git + CI), pas les certificats (régénérés), pas offsite.env (gestionnaire de mots de passe).
    # Seuls les chemins présents sont passés : un chemin absent rendrait l instantané « incomplet » (exit 3).
    paths=()
    for p in mtc crontab.current offsite.sh restore-test.sh etat-prod.sh watch-containers.sh watch-apihosts.sh; do
      [ -e "$BACKUPS/$p" ] && paths+=("/data/$p")
    done
    for p in databases static traefik/traefik.yml traefik/docker-compose.yml traefik/conf.d traefik/.env.traefik; do
      [ -e "/opt/infra/$p" ] && paths+=("/infra/$p")
    done
    for p in prod/.env.production discord-bot/.env; do
      [ -e "/opt/apps/mytradingcoach/$p" ] && paths+=("/apps/$p")
    done
    run backup --tag nightly "${paths[@]}"
    run forget --tag nightly --keep-daily 14 --keep-weekly 8 --keep-monthly 6 --prune
    if [ "$(date +%u)" = 7 ]; then run check --read-data-subset=5%; fi
    echo "[offsite] OK $(date -u +%FT%TZ)"
    ;;
  *) echo "usage : $0 [backup|snapshots|restore <instantané> <dossier>]"; exit 2 ;;
esac
