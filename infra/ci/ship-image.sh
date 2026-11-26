#!/usr/bin/env bash
# Envoie une image Docker construite sur le runner GitHub vers un VPS, sans registre (#1290).
#   infra/ci/ship-image.sh <fichier.tar> <user@hôte>
#
# Le tar vient de `docker buildx build --output type=docker,dest=…` (cd.yml, ci.yml). Il est compressé
# en zstd et envoyé par UNE seule connexion SSH (fail2ban), clé d'hôte épinglée (~/.ssh/known_hosts
# rempli par le job depuis PROD_VPS_KNOWN_HOSTS / DEV_VPS_KNOWN_HOSTS). Sur le VPS, `docker load`
# tourne sous le verrou mémoire (#1286) : jamais pendant la sauvegarde hors site.
# Aucun identifiant de registre : l'image ne quitte jamais le runner que vers le VPS.
set -euo pipefail

TAR=${1:?fichier tar de l\'image}
TARGET=${2:?user@hôte}
[ -s "$TAR" ] || { echo "❌ ${TAR} absent ou vide" >&2; exit 1; }

echo "[ship-image] $(date +%H:%M:%S) envoi de ${TAR} ($(du -h "$TAR" | cut -f1) non compressé) vers le VPS"
start=$(date +%s)
zstd -T0 -3 -q -c "$TAR" \
  | ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 "$TARGET" \
      "bash -o pipefail -c 'zstd -d -q -c | flock -w 1200 /tmp/mtc-memoire.lock docker load'"
echo "[ship-image] $(date +%H:%M:%S) image chargée en $(( $(date +%s) - start )) s"
