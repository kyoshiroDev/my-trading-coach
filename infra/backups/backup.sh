#!/bin/bash
# Dump nocturne des bases dev et beta (ancien VPS). Cron 3 h 00, log /opt/backups/mtc-backup.log.
set -eo pipefail
# Dumps créés en 600 : lisibles par leur seul propriétaire.
umask 077
BACKUP_DIR="/opt/backups/mtc"
TIMESTAMP=$(date +%Y%m%dT%H%M)

# Dump une base et supprime le fichier s'il est vide/tronque (evite de garder
# un backup corrompu qui donnerait une fausse impression de securite).
dump_db() {
  local db="$1" label="$2" required="$3"
  local path="$BACKUP_DIR/mtc_${label}_${TIMESTAMP}_auto.sql.gz"

  if docker exec mtc_postgres pg_dump -U mtc_user "$db" | gzip > "$path"; then
    # Un .gz valide non vide fait toujours plus de 1 Ko pour un dump reel.
    if gzip -t "$path" 2>/dev/null && [ "$(stat -c %s "$path")" -gt 1024 ]; then
      echo "[backup] $label OK ($(du -h "$path" | cut -f1))"
      return 0
    fi
  fi

  rm -f "$path"
  echo "[backup] $label ECHEC — fichier supprime"
  [ "$required" = "required" ] && return 1
  return 0
}

dump_db mytradingcoach_dev  dev  required
dump_db mytradingcoach_beta beta optional

# Purge : garder 14 jours max
find "$BACKUP_DIR" -name "*_auto.sql.gz" -mtime +14 -delete
echo "[backup] purge OK — $(date)"
