#!/bin/bash
# Sauvegarde hors-site (SCA-B7-09) : envoie les sauvegardes locales du VPS vers Backblaze B2,
# chiffrées par restic AVANT l'envoi (le fournisseur ne voit jamais les données en clair).
#
# Installé sur le VPS dans /opt/backups/offsite.sh, lancé par cron à 3 h 45, après backup.sh (3 h) et le nettoyage Docker (3 h 30).
# Identifiants : /opt/backups/offsite.env (chmod 600, jamais versionné) — modèle : offsite.env.example.
# Restic tourne dans un conteneur : rien à installer sur le VPS, pas de sudo.
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
grep -q 'A_COMPLETER' "$ENV_FILE" && { echo "[offsite] clés B2 non renseignées dans $ENV_FILE"; exit 1; }
mkdir -p "$CACHE"

run() { docker run --rm --env-file "$ENV_FILE" --hostname mtc-vps -v "$BACKUPS":/data:ro -v "$CACHE":/cache -e RESTIC_CACHE_DIR=/cache "$IMAGE" "$@"; }

case "${1:-backup}" in
  snapshots)
    run snapshots
    ;;
  restore)
    snap="${2:?instantané (ou latest)}"; target="${3:?dossier cible}"
    mkdir -p "$target"
    docker run --rm --env-file "$ENV_FILE" -v "$CACHE":/cache -e RESTIC_CACHE_DIR=/cache \
      -v "$(realpath "$target")":/restore "$IMAGE" restore "$snap" --target /restore
    ;;
  backup)
    echo "[offsite] début $(date -u +%FT%TZ)"
    # Premier lancement : le dépôt n'existe pas encore sur B2.
    run cat config >/dev/null 2>&1 || run init
    # Dumps des 3 bases (backup.sh) + configs (.env, Traefik, compose). Pas les images Docker :
    # elles se reconstruisent depuis git.
    run backup --tag nightly /data/mtc /data/apps/configs
    run forget --tag nightly --keep-daily 14 --keep-weekly 8 --keep-monthly 6 --prune
    # Vérification d'intégrité hebdomadaire (lit 5 % des données pour détecter une corruption).
    if [ "$(date +%u)" = 7 ]; then run check --read-data-subset=5%; fi
    echo "[offsite] OK $(date -u +%FT%TZ)"
    ;;
  *)
    echo "usage : $0 [backup|snapshots|restore <instantané> <dossier>]"; exit 2
    ;;
esac
