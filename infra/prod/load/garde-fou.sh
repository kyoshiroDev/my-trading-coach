#!/usr/bin/env bash
# Chien de garde du test de charge (2026-10-17) — tourne sur l'INJECTEUR, à côté de k6.
# Toutes les 5 s, mesure /api/health/ready de la VRAIE prod (api.mytradingcoach.app, même machine que
# l'environnement de test). Arrête le conteneur k6 si la prod souffre :
#   - p95 des 12 dernières sondes (1 min) > SEUIL_S, deux évaluations de suite ;
#   - ou 3 sondes de suite en échec (code ≠ 200 ou délai dépassé).
#
#   bash garde-fou.sh <nom du conteneur k6> [seuil en s, défaut 0.5] >> garde-fou.log
set -uo pipefail

K6="${1:?usage: $0 <conteneur k6> [seuil_s]}"
SEUIL="${2:-0.5}"
URL=https://api.mytradingcoach.app/api/health/ready
lat=(); echecs=0; depassements=0

log() { echo "[garde-fou] $(date +%T) $*"; }
log "surveillance de ${URL} · seuil p95 ${SEUIL} s · conteneur ${K6}"

while docker ps --format '{{.Names}}' | grep -qx "$K6"; do
  read -r code t < <(curl -s -o /dev/null -w '%{http_code} %{time_total}' --max-time 3 "$URL" || echo "000 3")
  if [ "$code" = 200 ]; then echecs=0; else echecs=$((echecs + 1)); fi
  lat+=("$t"); [ "${#lat[@]}" -gt 12 ] && lat=("${lat[@]:1}")
  p95=$(printf '%s\n' "${lat[@]}" | sort -n | awk '{v[NR]=$1} END {i=int(NR*0.95+0.999); if(i<1)i=1; print v[i]}')
  if awk -v p="$p95" -v s="$SEUIL" 'BEGIN{exit !(p>s)}'; then depassements=$((depassements + 1)); else depassements=0; fi
  log "prod ${code} ${t}s · p95(1 min) ${p95}s"
  if [ "$echecs" -ge 3 ] || { [ "${#lat[@]}" -ge 12 ] && [ "$depassements" -ge 2 ]; }; then
    log "🛑 ARRÊT : prod dégradée (échecs ${echecs}, p95 ${p95}s) → arrêt de ${K6}"
    docker stop -t 5 "$K6" >/dev/null 2>&1
    exit 2
  fi
  sleep 5
done
log "k6 terminé, fin de la surveillance"
