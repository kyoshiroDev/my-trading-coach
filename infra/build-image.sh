#!/usr/bin/env bash
# Construit une image Docker dans le builder BuildKit plafonné de MTC, puis la charge dans Docker.
#   infra/build-image.sh <dockerfile> <contexte> <tag>
# Lancé depuis la racine du dépôt (deploy-api.sh, cd.yml pour le bot Discord, CI de mesure).
#
# Pourquoi (#1286) : le VPS prod est partagé avec un autre projet hébergé qui doit garder 4 Gio.
# Un `docker build` classique tourne dans dockerd, sans plafond mémoire. Ici, le build tourne dans
# le conteneur `buildx_buildkit_mtc-build0` (pilote docker-container), plafonné à BUILD_MEM, un pas
# à la fois (infra/buildkitd.toml). Un dépassement tue le build : le script échoue AVANT toute
# migration ou bascule, la version en service continue de tourner.
set -euo pipefail

DOCKERFILE=${1:?dockerfile}
CONTEXT=${2:?contexte}
TAG=${3:?tag}
BUILDER=mtc-build
# Image (version épinglée) et config du builder : surchargées en CI seulement (miroir mirror.gcr.io,
# build-memory.yml). Changer de version = `docker buildx rm mtc-build` (lue à la création seulement).
BUILDKIT_IMAGE=${BUILDKIT_IMAGE:-moby/buildkit:v0.35.1}
BUILDKITD_CONFIG=${BUILDKITD_CONFIG:-infra/buildkitd.toml}
BUILD_MEM=1536m
BUILD_MEM_MIB=1536
MARGIN_MIB=256
ROOT=$(cd "$(dirname "$0")/.." && pwd)

log() { echo "[build-image] $(date +%H:%M:%S) $*"; }

# Verrou mémoire partagé avec deploy-api.sh et offsite.sh (#1286) : jamais de build pendant restic,
# sinon le pire cas dépasse la garantie. deploy-api.sh le tient déjà (MTC_MEMOIRE_LOCK=1).
if [ "${MTC_MEMOIRE_LOCK:-0}" != 1 ]; then
  exec 8>/tmp/mtc-memoire.lock
  flock -w 3600 8 || { log "❌ verrou mémoire tenu depuis plus d'1 h (sauvegarde hors site ?)"; exit 1; }
fi

# Garde-fou (règle 12 de deploy.md) : pas de build si la mémoire libre ne couvre pas le plafond du
# builder + une marge. MemAvailable exclut déjà la mémoire prise par l'autre projet hébergé.
avail=$(awk '/^MemAvailable:/ {print int($2 / 1024)}' /proc/meminfo)
need=$((BUILD_MEM_MIB + MARGIN_MIB))
if [ "$avail" -lt "$need" ]; then
  log "❌ mémoire disponible ${avail} Mio < ${need} Mio (builder ${BUILD_MEM_MIB} + marge ${MARGIN_MIB}) : build annulé, rien n'a changé"
  exit 1
fi
log "mémoire disponible ${avail} Mio (≥ ${need})"

# Builder créé une fois, réutilisé ensuite (son cache vit dans son conteneur). Plafond et config ne
# sont lus qu'à la création : pour les changer, `docker buildx rm mtc-build` (recréé au build suivant).
if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  log "création du builder ${BUILDER} (plafond ${BUILD_MEM})"
  docker buildx create --name "$BUILDER" --driver docker-container \
    --driver-opt "memory=${BUILD_MEM},memory-swap=${BUILD_MEM}" \
    --driver-opt "image=${BUILDKIT_IMAGE}" \
    --buildkitd-config "${ROOT}/${BUILDKITD_CONFIG}" >/dev/null
fi
docker buildx inspect --bootstrap "$BUILDER" >/dev/null
# Builder arrêté à la fin, même en échec : ses 1536 Mio ne s'ajoutent jamais à la bascule blue/green
# qui suit. Le cache (volume du builder) est gardé. BUILD_KEEP_RUNNING=1 : CI de mesure (memory.peak).
[ "${BUILD_KEEP_RUNNING:-0}" = 1 ] || trap 'docker buildx stop "$BUILDER" >/dev/null 2>&1 || true' EXIT

log "build ${TAG} (${DOCKERFILE}, builder ${BUILDER})"
docker buildx build --builder "$BUILDER" --load -f "$DOCKERFILE" -t "$TAG" ${BUILD_EXTRA_ARGS:-} "$CONTEXT"
