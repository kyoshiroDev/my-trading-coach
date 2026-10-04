#!/bin/bash
# État de la prod en un écran (SCA-B7-06, procédure jour J : docs/ops/jour-j.md). Lecture seule.
# Usage sur le VPS : /opt/backups/etat-prod.sh          (une fois)
#                    watch -n 30 /opt/backups/etat-prod.sh (en continu)
# Chaque ligne finit par OK ou ⚠️ avec le seuil dépassé.
set -uo pipefail
COMPOSE_DB=/opt/infra/databases/docker-compose.yml
PW=$(grep -m1 -oP 'password=\K[^ ,"]+' "$COMPOSE_DB" | head -1)  # 3 occurrences sur la ligne DATABASES
flag() { [ "${1:-0}" = 1 ] && echo "⚠️  $2" || echo "OK"; }
mib() { awk '{v=$1; u=$1; gsub(/[0-9.]/,"",u); if(u=="GiB")v*=1024; else if(u=="KiB")v/=1024; else if(u=="B")v/=1048576; printf "%d", v}'; }

echo "=== $(date '+%d/%m %H:%M:%S') · charge $(cut -d' ' -f1-3 /proc/loadavg) (4 cœurs)"

echo "--- Conteneurs (mémoire / limite)"
docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' | grep -E '^mtc_(api_prod(_blue|_green|_worker)?|postgres|pgbouncer|redis|traefik|discord_bot) ' | sort |
while read -r n cpu used _ lim; do
  u=$(echo "$used" | mib); l=$(echo "$lim" | mib); pct=$(( u * 100 / l ))
  printf '%-20s CPU %7s  %5d / %5d Mo (%2d %%)  %s\n' "$n" "$cpu" "$u" "$l" "$pct" "$(flag $([ $pct -ge 80 ] && echo 1) "mémoire ≥ 80 % de la limite")"
done
for c in $(docker ps -a --format '{{.Names}}' | grep '^mtc_'); do
  read -r st h r < <(docker inspect "$c" --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}} {{.RestartCount}}')
  # Couleur en cours de drain (déploiement blue/green) : unhealthy volontairement.
  if [ "$h" = unhealthy ] && docker exec "$c" test -f /tmp/drain 2>/dev/null; then echo "   $c : drain en cours (déploiement)"; continue; fi
  if [ "$st" != running ] || [ "$h" = unhealthy ] || [ "$r" != 0 ]; then echo "⚠️  $c : $st, santé $h, $r redémarrage(s)"; fi
done
dev_beta=$(docker ps --format '{{.Names}}' | grep -E '^mtc_api_(dev|beta)(_blue|_green|_worker)?$' | tr '\n' ' ')
echo "API dev/beta en marche : ${dev_beta:-aucune}  $(flag $([ -n "$dev_beta" ] && echo 1) "à arrêter le jour J (docs/ops/jour-j.md)")"

echo "--- API prod"
ready=$(curl -s -o /dev/null -w '%{http_code} %{time_total}' --max-time 5 https://api.mytradingcoach.app/api/health/ready)
echo "/health/ready : $ready s  $(flag $([ "${ready%% *}" != 200 ] && echo 1) "n'est pas 200")"
# Web (couleur(s) en marche) + worker ; ou le conteneur unique d'avant B8.
web=$(docker ps --format '{{.Names}}' | grep -E '^mtc_api_prod(_blue|_green)?$' | tr '\n' ' ')
echo "conteneur(s) web : ${web:-AUCUN}  $(flag $([ -z "$web" ] && echo 1) "aucun conteneur web")"
logs=$(for c in $(docker ps --format '{{.Names}}' | grep -E '^mtc_api_prod(_blue|_green|_worker)?$'); do docker logs --since 10m "$c" 2>&1; done)
e5=$(grep -c -E '"message":"5[0-9]{2} ' <<<"$logs"); e429=$(grep -c -E '"message":"429 ' <<<"$logs")
echo "10 dernières min : $e5 erreur(s) 5xx · $e429 réponse(s) 429  $(flag $([ "$e5" -ge 10 ] && echo 1) "≥ 10 erreurs 5xx : voir Sentry")"
grep -oE '"message":"5[0-9]{2} [A-Z]+ [^ ?"]+' <<<"$logs" | cut -d'"' -f4 | sort | uniq -c | sort -rn | head -3 | sed 's/^/   /'

echo "--- PgBouncer (prod)"
pool=$(docker exec -e PGPASSWORD="$PW" mtc_postgres psql -h mtc_pgbouncer -p 6432 -U mtc_user -d pgbouncer -At -F' ' -c 'SHOW POOLS' 2>/dev/null | awk '$1=="mytradingcoach_prod"{print $3, $4, $5, $6, $10}')
read -r cl_act cl_wait sv_act sv_idle maxwait <<<"${pool:-? ? ? ? ?}"
echo "clients actifs $cl_act · en attente $cl_wait (attente max ${maxwait}s) · serveur $sv_act actives / $sv_idle libres (pool 20)  $(flag $([ "$cl_wait" != "?" ] && [ "$cl_wait" -gt 0 ] && echo 1) "des requêtes attendent une connexion")"

echo "--- Postgres"
read -r conns maxc < <(docker exec mtc_postgres psql -U mtc_user -d postgres -At -F' ' -c "select (select count(*) from pg_stat_activity where backend_type='client backend'), current_setting('max_connections')")
echo "connexions $conns / $maxc  $(flag $([ "$conns" -ge 40 ] && echo 1) "≥ 40")"
slow=$(docker logs --since 10m mtc_postgres 2>&1 | grep -c 'duration:')
echo "requêtes > 500 ms (10 min) : $slow  $(flag $([ "$slow" -ge 20 ] && echo 1) "≥ 20 : voir pg_stat_statements (deploy.md)")"

echo "--- Redis prod"
RPW=$(grep -m1 -oP 'requirepass \K\S+' "$COMPOSE_DB")
info=$(docker exec mtc_redis redis-cli -a "$RPW" --no-auth-warning INFO memory 2>/dev/null)
used=$(grep -oP '^used_memory:\K\d+' <<<"$info"); max=$(grep -oP '^maxmemory:\K\d+' <<<"$info")
pct=$(( used * 100 / (max > 0 ? max : 1) ))
echo "mémoire $(( used / 1048576 )) / $(( max / 1048576 )) Mo ($pct %)  $(flag $([ $pct -ge 75 ] && echo 1) "≥ 75 % : en noeviction, Redis refuse les écritures à 100 % (BullMQ, limites)")"

echo "--- Disque /"
d=$(df --output=pcent / | tail -1 | tr -dc 0-9); echo "$d % utilisé  $(flag $([ "$d" -ge 85 ] && echo 1) "≥ 85 %")"
