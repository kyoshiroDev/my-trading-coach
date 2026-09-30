#!/usr/bin/env bash
# Échantillonne les ressources pendant un test de charge (PROMPT-136), toutes les INTERVAL s, en CSV.
#
#   PGURL=postgresql://…/mtc_dev REDIS_CLI="redis-cli -a …" ./tools/load-tests/monitor.sh > /tmp/mon.csv
#
# Sur un hôte Docker (VPS dev), utiliser plutôt `docker stats --no-stream` en parallèle : ce script
# mesure par groupe de process (node = API, postgres, redis, k6), ce qui marche avec ou sans Docker.
# Colonnes : horodatage, CPU% et RSS (Mo) par groupe, connexions PG (total / actives / en attente de
# verrou), mémoire Redis, taille des files BullMQ (wait + active), load average 1 min.
set -uo pipefail
INTERVAL="${INTERVAL:-10}"
PGURL="${PGURL:?PGURL manquante}"
REDIS_CLI="${REDIS_CLI:-redis-cli}"

# CPU instantané (delta utime+stime sur 1 s ; 100 = 1 cœur) et mémoire PSS (la mémoire partagée,
# ex. shared_buffers de Postgres, n'est comptée qu'une fois) par groupe de process.
ticks() { # somme utime+stime (en ticks) des pids donnés
  for p in "$@"; do awk '{print $14+$15}' /proc/$p/stat 2>/dev/null; done | awk '{s+=$1} END {print s+0}'
}
group() { # $1 = motif de commande → "cpu%,pss_mo"
  local pids t0 t1 pss
  pids=$(pgrep -f "$1" | tr '\n' ' ')
  [[ -z "${pids// }" ]] && { printf "0,0"; return; }
  t0=$(ticks $pids); sleep 1; t1=$(ticks $pids)
  pss=$(for p in $pids; do awk '/^Pss:/ {print $2}' /proc/$p/smaps_rollup 2>/dev/null; done | awk '{s+=$1} END {printf "%.0f", s/1024}')
  printf "%s,%s" "$(( (t1 - t0) * 100 / $(getconf CLK_TCK) ))" "$pss"
}

echo "ts,api_cpu,api_pss_mb,pg_cpu,pg_pss_mb,redis_cpu,redis_pss_mb,k6_cpu,k6_pss_mb,pg_conns,pg_active,pg_lockwait,redis_used_mb,bull_debrief,bull_stripe,load1"
while true; do
  pg=$(psql "$PGURL" -Atc "select count(*), count(*) filter (where state='active'), count(*) filter (where wait_event_type='Lock') from pg_stat_activity where backend_type='client backend'" | tr '|' ',')
  rmem=$($REDIS_CLI info memory 2>/dev/null | awk -F: '/^used_memory:/ {printf "%.0f", $2/1048576}')
  bd=$(( $($REDIS_CLI llen bull:debrief:wait 2>/dev/null || echo 0) + $($REDIS_CLI llen bull:debrief:active 2>/dev/null || echo 0) ))
  bs=$(( $($REDIS_CLI llen bull:stripe:wait 2>/dev/null || echo 0) + $($REDIS_CLI llen bull:stripe:active 2>/dev/null || echo 0) ))
  echo "$(date +%H:%M:%S),$(group 'node .*main\.js'),$(group '^postgres'),$(group 'redis-server'),$(group 'k6 run'),$pg,$rmem,$bd,$bs,$(cut -d' ' -f1 /proc/loadavg)"
  sleep "$INTERVAL"
done
