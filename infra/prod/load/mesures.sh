#!/usr/bin/env bash
# Mesures du test de charge sur le VPS prod (2026-10-17), une ligne CSV toutes les 15 s. Lecture seule.
#   nohup bash mesures.sh /opt/infra/load/mesures-$(date +%Y%m%d-%H%M).csv >/dev/null 2>&1 &
#   (arrêt : pkill -f infra/load/mesures.sh  ou  pkill -f 'bash mesures.sh')
# Colonnes : heure, charge 1 min, CPU % / mémoire Mo par conteneur (test + prod), pool PgBouncer de
# test (clients actifs, en attente, serveur actives, attente max s), connexions Postgres de test,
# mémoire Redis de test (Mo), requêtes > 500 ms de la base de test depuis le début.
set -uo pipefail
OUT=${1:?fichier CSV}
cd "$(dirname "$0")"
PG=$(grep -m1 '^LOAD_PG_PASSWORD=' .env | cut -d= -f2-)
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
WATCH="load_api load_postgres load_pgbouncer load_redis $(docker ps --format '{{.Names}}' | grep -E '^mtc_api_prod_(blue|green)$' | head -1) mtc_postgres mtc_traefik"
mib() { awk '{v=$1; u=$1; gsub(/[0-9.]/,"",u); if(u=="GiB")v*=1024; else if(u=="KiB")v/=1024; else if(u=="B")v/=1048576; printf "%d", v}'; }

{ printf 'heure,charge1m'; for c in $WATCH; do printf ',%s_cpu,%s_mo' "$c" "$c"; done
  echo ',pgb_cl_actifs,pgb_cl_attente,pgb_sv_actifs,pgb_attente_max_s,pg_connexions,redis_mo,pg_lentes'; } > "$OUT"

while true; do
  stats=$(docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}')
  line="$(date +%H:%M:%S),$(cut -d' ' -f1 /proc/loadavg)"
  for c in $WATCH; do
    read -r cpu used < <(awk -v n="$c" '$1==n {print $2, $3}' <<<"$stats")
    line+=",${cpu:-},$(echo "${used:-0B}" | mib)"
  done
  # Colonnes de SHOW POOLS (PgBouncer ≥ 1.18) : 3 cl_active · 4 cl_waiting · 7 sv_active · 14 maxwait.
  pool=$(docker exec -e PGPASSWORD="$PG" load_postgres psql -h load_pgbouncer -p 6432 -U mtc_user -d pgbouncer -At -F' ' \
    -c 'SHOW POOLS' 2>/dev/null | awk '$1=="mytradingcoach_load"{print $3","$4","$7","$14}')
  conns=$(docker exec load_postgres psql -U mtc_user -d mytradingcoach_load -At \
    -c "select count(*) from pg_stat_activity where backend_type='client backend'" 2>/dev/null)
  redis=$(docker exec load_redis redis-cli --no-auth-warning info memory 2>/dev/null | awk -F: '/^used_memory:/{printf "%d", $2/1048576}')
  slow=$(docker logs --since "$START" load_postgres 2>&1 | grep -c 'duration:')
  echo "${line},${pool:-,,,},${conns},${redis},${slow}" >> "$OUT"
  sleep 15
done
