#!/bin/bash
# Commande forcée de la clé SSH de l'API prod vers le VPS prod.
#
# Installé en /usr/local/bin/mtc-api-admin (root:root, 755) et appelé par authorized_keys :
# command="/usr/local/bin/mtc-api-admin",restrict (+ from= limité au réseau Docker).
# N'exécute que les commandes de la page Surveillance et des sauvegardes de l'admin
# (apps/api-mytradingcoach/src/modules/vps/) :
#   - lectures : lignes de /etc/mtc-api-admin/allowed-commands (copie de
#     infra/prod/ssh/mtc-api-admin-allowed-commands), comparées à l'identique ;
#   - docker start|stop|restart <container>, docker logs -f --tail 100 <container> ;
#   - dump manuel de mytradingcoach_prod et suppression d'un dump dans /opt/backups/mtc.
# Les commandes paramétrées sont reconstruites ici à partir des valeurs validées, jamais passées
# telles quelles à un shell. Tout le reste est refusé (code 126) et journalisé.
#
# Test sans rien exécuter : SSH_ORIGINAL_COMMAND='…' mtc-api-admin --check
# (en --check seulement, MTC_API_ADMIN_ALLOWED peut désigner une autre liste : test du dépôt).
set -uo pipefail
umask 077

BACKUP_DIR=/opt/backups/mtc
ALLOWED=/etc/mtc-api-admin/allowed-commands
CMD="${SSH_ORIGINAL_COMMAND:-}"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1
[ "$CHECK" = 1 ] && ALLOWED="${MTC_API_ADMIN_ALLOWED:-$ALLOWED}"

refuse() {
  [ "$CHECK" = 1 ] && { echo "REFUS ($1)"; exit 126; }
  logger -t mtc-api-admin -- "commande refusée ($1) : $(printf '%q' "$CMD")"
  echo "mtc-api-admin : commande refusée" >&2
  exit 126
}

# Exécute argv sans shell ; les actions qui modifient quelque chose sont journalisées.
run() {
  local log=$1; shift
  if [ "$CHECK" = 1 ]; then printf 'OK:'; printf ' [%s]' "$@"; echo; exit 0; fi
  [ "$log" = log ] && logger -t mtc-api-admin -- "exécute : $*"
  exec "$@"
}

[ -n "$CMD" ] || refuse "shell interactif"
# Aucun caractère de contrôle hormis la tabulation (docker stats) : pas de retour à la ligne ni de
# retour chariot, donc une seule commande.
[[ "${CMD//$'\t'/}" == *[[:cntrl:]]* ]] && refuse "caractère de contrôle"

# Lectures autorisées : une par ligne, tabulations réelles comprises.
if [ -r "$ALLOWED" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    if [ "$line" = "$CMD" ]; then
      run nolog /bin/sh -c "$CMD"
    fi
  done < "$ALLOWED"
fi

REF='[A-Za-z0-9][A-Za-z0-9_.-]{0,127}'   # CONTAINER_REF de docker.service.ts
NAME='[A-Za-z0-9][A-Za-z0-9_-]{0,127}'   # nom de container des logs

if [[ "$CMD" =~ ^docker\ (start|stop|restart)\ ($REF)$ ]]; then
  run log docker "${BASH_REMATCH[1]}" -- "${BASH_REMATCH[2]}"
fi

if [[ "$CMD" =~ ^docker\ logs\ -f\ --tail\ 100\ ($NAME)$ ]]; then
  run log docker logs -f --tail 100 -- "${BASH_REMATCH[1]}"
fi

# backup.service.ts createBackup : `… pg_dump -U mtc_user <db> | gzip > <chemin> && stat -c %s <chemin>`
DUMP="$BACKUP_DIR/mtc_prod_([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4})_manual\.sql\.gz"
if [[ "$CMD" =~ ^docker\ exec\ mtc_postgres\ pg_dump\ -U\ mtc_user\ mytradingcoach_prod\ \|\ gzip\ \>\ $DUMP\ \&\&\ stat\ -c\ %s\ $DUMP$ ]]; then
  [ "${BASH_REMATCH[1]}" = "${BASH_REMATCH[2]}" ] || refuse "chemins de dump différents"
  path="$BACKUP_DIR/mtc_prod_${BASH_REMATCH[1]}_manual.sql.gz"
  if [ "$CHECK" = 1 ]; then echo "OK: dump mytradingcoach_prod -> [$path]"; exit 0; fi
  logger -t mtc-api-admin -- "exécute : dump mytradingcoach_prod vers $path"
  if docker exec mtc_postgres pg_dump -U mtc_user mytradingcoach_prod | gzip > "$path"; then
    exec stat -c %s "$path"
  fi
  rm -f -- "$path"
  echo "mtc-api-admin : dump en échec" >&2
  exit 1
fi

# backup.service.ts deleteBackup : `rm -f <BACKUP_DIR>/<fichier>.sql.gz`, sans « / » dans le nom.
if [[ "$CMD" =~ ^rm\ -f\ $BACKUP_DIR/([A-Za-z0-9][A-Za-z0-9_.-]{0,200}\.sql\.gz)$ ]]; then
  run log rm -f -- "$BACKUP_DIR/${BASH_REMATCH[1]}"
fi

refuse "hors liste"
