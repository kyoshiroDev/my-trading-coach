#!/usr/bin/env bash
# CI seulement (build-memory.yml, #1286) : construit une image dans le builder plafonné et mesure
# la mémoire NON récupérable du builder (anon + kernel de memory.stat), échantillonnée toutes les
# 0,5 s. memory.peak compte aussi le cache de pages, que le noyau récupère avant tout OOM : il
# touche le plafond sans risque et n'est affiché que pour information.
#   infra/ci/build-memory-measure.sh <libellé> <dockerfile> <contexte> <tag>
set -euo pipefail
LABEL=$1; shift
C=buildx_buildkit_mtc-build0
WARN_MIB=${WARN_MIB:-1331}
OUT=$(mktemp -d)

stat_mib() { # anon + kernel en Mio ; "anon" seul si le noyau n'expose pas kernel
  docker exec "$C" awk '/^anon /{a=$2} /^kernel /{k=$2; hk=1} END{printf "%d %s\n", (a+k)/1048576, (hk ? "anon+kernel" : "anon")}' /sys/fs/cgroup/memory.stat 2>/dev/null
}

sampler() {
  local max=0 kind=? v k
  while [ ! -f "$OUT/stop" ]; do
    if read -r v k < <(stat_mib); then
      kind=$k
      [ "$v" -gt "$max" ] && max=$v
      echo "$max $kind" > "$OUT/peak"
    fi
    sleep 0.5
  done
}

# Builder recréé : compteurs (peak, events) à zéro pour cette image.
docker buildx rm mtc-build >/dev/null 2>&1 || true
sampler &
SAMPLER=$!
rc=0
BUILD_KEEP_RUNNING=1 bash infra/build-image.sh "$@" || rc=$?
touch "$OUT/stop"; wait "$SAMPLER" || true

read -r nr kind < "$OUT/peak" || { echo "::error::échantillonnage de memory.stat impossible ($LABEL)"; exit 1; }
peak=$(( $(docker exec "$C" cat /sys/fs/cgroup/memory.peak) / 1048576 ))
events=$(docker exec "$C" cat /sys/fs/cgroup/memory.events)
oom_kill=$(awk '/^oom_kill /{print $2}' <<<"$events")
hits=$(awk '/^max /{print $2}' <<<"$events")

line="$LABEL : pic non récupérable ${nr} Mio (${kind}) · memory.peak ${peak} Mio (cache compris, info) · plafond touché ${hits:-0} fois · oom_kill ${oom_kill:-0}"
echo "$line" | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
[ "$kind" = anon+kernel ] || echo "::notice::$LABEL : kernel absent de memory.stat, mesure sur anon seul"
[ "$rc" = 0 ] || { echo "::error::build $LABEL en échec (code $rc)"; exit "$rc"; }
[ "${oom_kill:-0}" = 0 ] || { echo "::error::$LABEL : ${oom_kill} processus tués par l'OOM dans le builder"; exit 1; }
[ "$nr" -le "$WARN_MIB" ] || echo "::warning::$LABEL : pic non récupérable ${nr} Mio, au-dessus de ${WARN_MIB} Mio (plafond 1536)"
