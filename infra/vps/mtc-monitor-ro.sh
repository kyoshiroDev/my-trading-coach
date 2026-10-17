#!/bin/sh
# Commande forcée de la clé SSH « mtc-monitor » (API prod → ancien VPS, lecture seule).
#
# Installé sur l'ancien VPS en /usr/local/bin/mtc-monitor-ro (root:root, 755) et appelé par
# authorized_keys : command="/usr/local/bin/mtc-monitor-ro". N'exécute que les commandes listées À
# L'IDENTIQUE dans /etc/mtc-monitor/allowed-commands (copie de infra/vps/mtc-monitor-allowed-commands,
# générée depuis apps/api-mytradingcoach/src/modules/vps/vps-commands.ts). Tout le reste est refusé
# (pas de docker start/stop/restart/rm, pas de docker logs, pas de shell).
set -eu

ALLOWED=/etc/mtc-monitor/allowed-commands
cmd="${SSH_ORIGINAL_COMMAND:-}"

if [ -n "$cmd" ] && grep -Fxq -- "$cmd" "$ALLOWED"; then
  exec /bin/sh -c "$cmd"
fi

logger -t mtc-monitor-ro -- "commande refusée : $cmd"
echo "mtc-monitor : commande refusée" >&2
exit 126
