#!/bin/bash
# Mesures côté serveur pendant un test de charge (SCA-B9), une ligne CSV toutes les 15 s.
# Sur le VPS : nohup /opt/backups/collect-metrics.sh /opt/backups/charge-$(date +%Y%m%d-%H%M).csv &
#              (arrêt : kill %1, ou pkill -f collect-metrics.sh)
# Lecture seule. Colonnes : heure, charge 1 min, CPU % / mémoire Mo des conteneurs suivis, pool
# PgBouncer de beta (clients actifs, en attente, connexions serveur actives, attente max en s),
# connexions Postgres, mémoire Redis beta (Mo), requêtes Postgres > 500 ms depuis le début.
set -uo pipefail
OUT=${1:?fichier CSV}
DB=/opt/infra/databases
PW=$(grep -m1 -oP 'password=\K[^ ,"]+' $DB/docker-compose.yml | head -1)
RPW=$(grep -m1 -oP 'requirepass \K\S+' $DB/docker-compose.beta.yml)
# Conteneurs API trouvés par leur nom : la prod tourne en blue/green (mtc_api_prod_blue / _green
# + mtc_api_prod_worker), le nom change à chaque déploiement.
WATCH="$(docker ps --format '{{.Names}}' | grep -E '^mtc_api_(beta|prod_(blue|green|worker))$' | sort | tr '\n' ' ')mtc_postgres mtc_pgbouncer mtc_redis_beta mtc_traefik"
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
mib() { awk '{v=$1; u=$1; gsub(/[0-9.]/,"",u); if(u=="GiB")v*=1024; else if(u=="KiB")v/=1024; else if(u=="B")v/=1048576; printf "%d", v}'; }

{ printf 'heure,charge1m'; for c in $WATCH; do printf ',%s_cpu,%s_mo' "${c#mtc_}" "${c#mtc_}"; done
  echo ',pgb_cl_actifs,pgb_cl_attente,pgb_sv_actifs,pgb_attente_max_s,pg_connexions,redis_beta_mo,pg_lentes'; } > "$OUT"

while true; do
  stats=$(docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}')
  line="$(date +%H:%M:%S),$(cut -d' ' -f1 /proc/loadavg)"
  for c in $WATCH; do
    read -r cpu used < <(awk -v n="$c" '$1==n{print $2, $3}' <<<"$stats")
    line+=",${cpu%\%},$(echo "${used:-0MiB}" | mib)"
  done
  pool=$(docker exec -e PGPASSWORD="$PW" mtc_postgres psql -h mtc_pgbouncer -p 6432 -U mtc_user -d pgbouncer -At -F' ' -c 'SHOW POOLS' 2>/dev/null | awk '$1=="mytradingcoach_beta"{print $3","$4","$5","$10}')
  conns=$(docker exec mtc_postgres psql -U mtc_user -d postgres -Atc "select count(*) from pg_stat_activity where backend_type='client backend'")
  rmem=$(docker exec mtc_redis_beta redis-cli -a "$RPW" --no-auth-warning INFO memory 2>/dev/null | grep -oP '^used_memory:\K\d+')
  slow=$(docker logs --since "$START" mtc_postgres 2>&1 | grep -c 'duration:')
  echo "$line,${pool:-,,,},$conns,$(( ${rmem:-0} / 1048576 )),$slow" >> "$OUT"
  sleep 15
done
