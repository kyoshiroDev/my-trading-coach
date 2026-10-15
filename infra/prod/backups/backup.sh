#!/bin/bash
# Dump nocturne de la base PROD (VPS prod). Cron greg 3 h 00, log /opt/backups/mtc-backup.log.
# Écrit dans /opt/backups/mtc : l app admin (BackupService, BACKUP_DIR) lit ce dossier.
# Un dump vide ou tronqué est supprimé (pas de fausse impression de sécurité).
set -eo pipefail
BACKUP_DIR="/opt/backups/mtc"
TIMESTAMP=$(date +%Y%m%dT%H%M)
path="$BACKUP_DIR/mtc_prod_${TIMESTAMP}_auto.sql.gz"

if docker exec mtc_postgres pg_dump -U mtc_user mytradingcoach_prod | gzip > "$path" \
   && gzip -t "$path" 2>/dev/null && [ "$(stat -c %s "$path")" -gt 1024 ]; then
  echo "[backup] prod OK ($(du -h "$path" | cut -f1)) — $(date)"
else
  rm -f "$path"; echo "[backup] prod ECHEC — fichier supprime — $(date)"; exit 1
fi

find "$BACKUP_DIR" -name "*_auto.sql.gz" -mtime +14 -delete
