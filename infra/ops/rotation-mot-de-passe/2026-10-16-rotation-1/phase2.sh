#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════════════════════════
# ARCHIVE — 1re rotation du mot de passe de mtc_user, VPS prod, 16/10/2026. MODÈLE, ne pas lancer tel quel.
# - sudo n'est plus sans mot de passe sur le VPS prod (exception de migration retirée le 17/10/2026) :
#   l'étape 0 (« sudo -n true », « sudo test », « sudo grep ») s'arrête et les écritures de
#   userlist.txt (sudo tee, chown) échouent. Prochaine fois : lancer dans un terminal où sudo a déjà
#   été validé par Greg, ou réécrire ces étapes (docker run … alpine pour userlist.txt).
# - Chemins datés (rotation-20261016*, SHA 1a67cbde987a) à adapter ; dossiers R/B à préparer à part
#   (nouveau mot de passe dans un fichier 600, .new, copies d'avant), voir docs/ops/maintenance-2026-10-17.md.
# - Aucun secret ici : les mots de passe sont lus dans des fichiers 600 et ne passent ni à l'écran ni
#   en argument de commande. Préférer la version 2e rotation (indépendante de la couleur).
# ════════════════════════════════════════════════════════════════════════════════════════════════
# Temps 2 — rotation du mot de passe de mtc_user + log_timezone (VPS prod 149.202.40.240).
# Lancé par greg, après le « GO » de Greg, en arrière-plan :
#   setsid nohup bash ~/rotation/phase2.sh > ~/rotation/phase2.log 2>&1 < /dev/null &
# Contrôles seuls (lecture seule, aucune modification) : bash ~/rotation/phase2.sh --controles
# Aucun secret n'est affiché ni passé en argument de commande (ps) : les mots de passe passent par
# l'entrée standard ou par l'environnement d'un processus docker (-e NOM sans valeur).
# Arrêts automatiques :
#   - dry-run qui touche Postgres → arrêt AVANT toute modification ;
#   - SELECT 1 raté (PgBouncer ou direct) → rollback.sh ;
#   - service non rétabli 180 s après le début de la coupure → rollback.sh.
set -uo pipefail

R=/opt/apps/mytradingcoach/prod-secrets/rotation-20261016        # nouveaux fichiers (.new)
B=/opt/apps/mytradingcoach/prod-secrets/env-backups/rotation-20261016   # copies d'avant
P=/opt/apps/mytradingcoach/prod                                   # dépôt + .env.production de l'API
DB=/opt/infra/databases                                           # compose des bases + .env
SHA=1a67cbde987a
MAX_CUT=180
HERE=$(cd "$(dirname "$0")" && pwd)

log() { echo "[phase2] $(TZ=Europe/Paris date +%H:%M:%S) $*"; }
stop_here() { log "⛔ $* — arrêt, AUCUNE modification faite."; exit 1; }
CUT_START=""
elapsed() { echo $(( $(date +%s) - CUT_START )); }
rollback() {
  log "❌ $* → retour arrière (coupure depuis $(elapsed) s)"
  bash "$HERE/rollback.sh"
  log "fin du retour arrière (coupure totale : $(elapsed) s). Rapport à faire à Greg."
  exit 2
}
deadline() { [ "$(elapsed)" -lt "$MAX_CUT" ] || rollback "coupure > ${MAX_CUT} s sans service rétabli"; }
# Session de l'ALTER ROLE : rien ne doit pouvoir écrire la commande (et donc le mot de passe) dans
# un journal Postgres ni dans pg_stat_statements.
QUIET="SET log_min_error_statement = panic; SET log_min_duration_statement = -1; SET log_statement = 'none'; SET pg_stat_statements.track_utility = off;"
admin() { docker exec -i mtc_postgres psql -U mtc_admin -d postgres -v ON_ERROR_STOP=1 -q -At "$@"; }   # -q : pas de « SET » en sortie
# SELECT 1 avec un mot de passe passé par l'environnement de docker exec (jamais en argument).
select1() { # $1 = hôte, $2 = port, $3 = mot de passe
  PGPASSWORD="$3" PGCONNECT_TIMEOUT=5 docker exec -e PGPASSWORD -e PGCONNECT_TIMEOUT mtc_postgres \
    psql -h "$1" -p "$2" -U mtc_user -d mytradingcoach_prod -Atc 'select 1' 2>/dev/null
}

# ── 0. Contrôles, sans rien modifier ───────────────────────────────────────────────────────
log "0. contrôles préalables"
for f in "$R/mtc_user.new" "$R/databases.env.new" "$R/.env.production.new" \
         "$B/databases.env" "$B/.env.production" "$B/userlist.txt" "$HERE/rollback.sh"; do
  sudo test -s "$f" || stop_here "fichier manquant ou vide : $f"
done
docker image inspect "mtc_api_prod:$SHA" >/dev/null 2>&1 || stop_here "image mtc_api_prod:$SHA absente"
[ "$(docker inspect -f '{{.State.Health.Status}}' mtc_api_prod_blue 2>/dev/null)" = healthy ] \
  || stop_here "mtc_api_prod_blue n'est pas healthy (couleur active attendue : blue)"
! docker inspect mtc_api_prod_green >/dev/null 2>&1 || stop_here "mtc_api_prod_green existe déjà"
# Les URL préparées visent bien PgBouncer et Postgres (hôte:port/base), sans afficher le mot de passe.
grep -qE '^DATABASE_URL=postgres(ql)?://mtc_user:[A-Za-z0-9]{40}@mtc_pgbouncer:6432/mytradingcoach_prod([?].*)?$' "$R/.env.production.new" \
  || stop_here "DATABASE_URL préparée inattendue"
grep -qE '^DATABASE_DIRECT_URL=postgres(ql)?://mtc_user:[A-Za-z0-9]{40}@mtc_postgres:5432/mytradingcoach_prod([?].*)?$' "$R/.env.production.new" \
  || stop_here "DATABASE_DIRECT_URL préparée inattendue"
DRY=$(cd "$DB" && docker compose -p databases --env-file "$R/databases.env.new" --dry-run up -d --no-deps pgbouncer 2>&1)
echo "$DRY" | sed 's/^/    dry-run | /'
echo "$DRY" | grep -q 'mtc_pgbouncer' || stop_here "le dry-run ne mentionne pas mtc_pgbouncer"
! echo "$DRY" | grep -qi 'postgres\b\|mtc_postgres' || stop_here "le dry-run touche Postgres"
# Journalisation Postgres (valeurs globales) et réglages de session vérifiés.
LS=$(admin -c "show log_statement"); LMD=$(admin -c "show log_min_duration_statement")
LME=$(admin -c "show log_min_error_statement"); TU=$(admin -c "show pg_stat_statements.track_utility")
log "   global : log_statement=$LS · log_min_duration_statement=$LMD · log_min_error_statement=$LME · pg_stat_statements.track_utility=$TU"
case "$LS" in ddl|mod|all) stop_here "log_statement=$LS journaliserait l'ALTER ROLE" ;; esac
[ "$LMD" != 0 ] || stop_here "log_min_duration_statement=0 journalise toutes les requêtes"
SESS=$(admin -F '|' -c "$QUIET select current_setting('log_min_error_statement'), current_setting('log_min_duration_statement'), current_setting('log_statement'), current_setting('pg_stat_statements.track_utility'), 1")
log "   session mtc_admin après SET : $SESS (attendu panic|-1|none|off|1)"
[ "$SESS" = "panic|-1|none|off|1" ] || stop_here "les réglages de session ne s'appliquent pas"
sudo -n true 2>/dev/null || stop_here "sudo -n refusé"
log "   sudo -n : OK"
[ "$(sudo grep -c '^"mtc_user" "SCRAM-SHA-256\$' "$DB/pgbouncer-auth/userlist.txt")" = 1 ] \
  && [ "$(sudo awk 'END { print NR }' "$DB/pgbouncer-auth/userlist.txt")" = 1 ] \
  || stop_here "userlist.txt actuel inattendu"
log "   userlist.txt actuel : une ligne \"mtc_user\" \"SCRAM-SHA-256\$…\" OK"
NEW=$(< "$R/mtc_user.new")
OLD=$(grep -m1 '^MTC_USER_PASSWORD=' "$B/databases.env" | cut -d= -f2-)
# Format vérifié sans rien afficher, avant toute modification.
[[ "$NEW" =~ ^[A-Za-z0-9]{40}$ ]] || stop_here "mtc_user.new n'est pas exactement 40 caractères alphanumériques"
[ -n "$OLD" ] || stop_here "ancien mot de passe vide dans $B/databases.env"
log "   NEW : 40 caractères alphanumériques · OLD : non vide"
[ "$(select1 mtc_pgbouncer 6432 "$OLD")" = 1 ] || stop_here "l'ancien mot de passe ne passe pas aujourd'hui via PgBouncer"
log "   SELECT 1 via PgBouncer avec l'ancien mot de passe : OK"
unset OLD
log "contrôles OK"
# --controles : s'arrête ici (lecture seule, rien n'est modifié).
if [ "${1:-}" = "--controles" ]; then unset NEW; log "mode --controles : arrêt après les contrôles"; exit 0; fi

# ── 1. Worker arrêté (pas d'écriture pendant l'opération). Le bot reste en marche. ──────────
log "1. arrêt du worker"
docker stop -t 30 mtc_api_prod_worker >/dev/null || stop_here "arrêt du worker impossible"

# ── 2. Début de la coupure : ALTER ROLE ────────────────────────────────────────────────────
CUT_START=$(date +%s)
log "2. DÉBUT DE COUPURE — ALTER ROLE mtc_user"
# Mot de passe sur l'entrée standard, dans une session où rien ne journalise la commande ($QUIET).
if ! printf "%s\nALTER ROLE mtc_user PASSWORD '%s';\n" "$QUIET" "$NEW" \
     | docker exec -i mtc_postgres psql -U mtc_admin -d postgres -v ON_ERROR_STOP=1 -q; then
  rollback "ALTER ROLE en échec"
fi

# ── 3. Fichiers de configuration (mêmes inodes, droits conservés) ──────────────────────────
log "3. .env des bases et .env.production"
cat "$R/databases.env.new" > "$DB/.env" || rollback "écriture de $DB/.env"
cat "$R/.env.production.new" > "$P/.env.production" || rollback "écriture de .env.production"

# ── 4. userlist.txt de PgBouncer (empreinte SCRAM, jamais affichée) ───────────────────────
log "4. userlist.txt"
SCRAM=$(docker exec mtc_postgres psql -U mtc_admin -d postgres -Atc "select rolpassword from pg_authid where rolname='mtc_user'")
case "$SCRAM" in SCRAM-SHA-256\$*) ;; *) rollback "empreinte SCRAM inattendue" ;; esac
printf '"mtc_user" "%s"\n' "$SCRAM" | sudo tee "$DB/pgbouncer-auth/userlist.txt" >/dev/null || rollback "écriture userlist"
sudo chown 70:70 "$DB/pgbouncer-auth/userlist.txt" && sudo chmod 600 "$DB/pgbouncer-auth/userlist.txt"
unset SCRAM
deadline

# ── 5. Recréation de PgBouncer seul ────────────────────────────────────────────────────────
log "5. recréation de PgBouncer (--no-deps)"
(cd "$DB" && docker compose -p databases up -d --no-deps pgbouncer 2>&1 | sed 's/^/    compose | /') || rollback "compose up pgbouncer"

# ── 6. SELECT 1 avec le nouveau mot de passe : via PgBouncer puis en direct ────────────────
log "6. SELECT 1 (nouveau mot de passe)"
ok_b=""; for _ in $(seq 1 15); do [ "$(select1 mtc_pgbouncer 6432 "$NEW")" = 1 ] && { ok_b=1; break; }; sleep 1; done
[ -n "$ok_b" ] || rollback "SELECT 1 via PgBouncer (DATABASE_URL) en échec"
log "   via PgBouncer : OK"
[ "$(select1 mtc_postgres 5432 "$NEW")" = 1 ] || rollback "SELECT 1 direct (DATABASE_DIRECT_URL) en échec"
log "   direct        : OK"
deadline

# ── 7. Redéploiement de l'API (même SHA), surveillé ────────────────────────────────────────
log "7. deploy-api.sh prod $SHA"
DLOG="$HERE/deploy-api.log"
# setsid -w : nouveau groupe de processus (que rollback.sh peut tuer en entier, via deploy.pid écrit
# par le chef de groupe lui-même), et DPID attend la fin du déploiement en rendant son code.
rm -f "$HERE/deploy.pid"
( cd "$P" && exec setsid -w bash -c 'echo $$ > "$1"; exec bash infra/deploy-api.sh prod "$2"' _ "$HERE/deploy.pid" "$SHA" ) > "$DLOG" 2>&1 &
DPID=$!
# « reçoit du trafic » : la nouvelle couleur sert déjà, mais blue (healthcheck sans base) reste dans
# Traefik jusqu'à son drain → service partiel. « requêtes en cours » : blue retiré de Traefik → complet.
SERVING=""; FULL=""
while kill -0 "$DPID" 2>/dev/null; do
  if [ -z "$SERVING" ] && grep -q 'reçoit du trafic' "$DLOG"; then
    SERVING=$(date +%s); log "service PARTIEL rétabli (nouvelle couleur dans Traefik) : $(( SERVING - CUT_START )) s"
  fi
  if [ -z "$FULL" ] && grep -q 'requêtes en cours' "$DLOG"; then
    FULL=$(date +%s); log "FIN DE COUPURE (blue retiré de Traefik) : $(( FULL - CUT_START )) s"
  fi
  [ -n "$SERVING" ] || deadline
  sleep 2
done
wait "$DPID"; DCODE=$?
rm -f "$HERE/deploy.pid"   # déploiement fini : rollback.sh n'a plus rien à tuer
sed 's/^/    deploy | /' "$DLOG" | grep -E '\[deploy-api' | tail -20
if [ -z "$SERVING" ] && grep -q 'reçoit du trafic' "$DLOG"; then SERVING=$(date +%s); fi
if [ -z "$FULL" ] && grep -q 'requêtes en cours' "$DLOG"; then FULL=$(date +%s); fi
[ -n "$SERVING" ] || rollback "deploy-api.sh terminé (code $DCODE) sans nouvelle couleur en service"
[ "$DCODE" = 0 ] || log "⚠️ deploy-api.sh code $DCODE APRÈS rétablissement du service : pas de retour arrière, rapport à Greg"
unset NEW

# ── 8. log_timezone en UTC, sans redémarrage ───────────────────────────────────────────────
log "8. log_timezone = UTC (ALTER SYSTEM + pg_reload_conf)"
docker exec mtc_postgres psql -U mtc_admin -d postgres -v ON_ERROR_STOP=1 -Atc "ALTER SYSTEM SET log_timezone = 'UTC'" >/dev/null \
  && docker exec mtc_postgres psql -U mtc_admin -d postgres -Atc "select pg_reload_conf()" >/dev/null \
  || log "⚠️ log_timezone non appliqué (sans effet sur le service)"
log "   log_timezone = $(docker exec mtc_postgres psql -U mtc_admin -d postgres -Atc 'show log_timezone')"

# ── 9. État final ─────────────────────────────────────────────────────────────────────────
for c in mtc_api_prod_blue mtc_api_prod_green mtc_api_prod_worker mtc_pgbouncer mtc_postgres; do
  log "   $(docker inspect -f '{{.Name}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$c" 2>&1)"
done
log "   /api/health/ready : $(curl -s -o /dev/null -w '%{http_code}' https://api.mytradingcoach.app/api/health/ready)"
log "✅ terminé. Début de coupure $(TZ=Europe/Paris date -d @"$CUT_START" +%H:%M:%S) · service partiel +$(( SERVING - CUT_START )) s · fin de coupure ${FULL:+$(TZ=Europe/Paris date -d @"$FULL" +%H:%M:%S), durée $(( FULL - CUT_START )) s}${FULL:-non détectée, voir deploy-api.log}"
