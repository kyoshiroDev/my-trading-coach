#!/bin/bash
# Alerte quand les hôtes Tradovate (`apiHosts`) des connexions changent (#420, suite de #286).
#
# NinjaTrader peut basculer l'hôte demo / reporting d'une prop firm sur une infra dédiée : l'API
# relit `apiHosts` toutes les 30 min et suit seule (cf. tradovate-hosts.ts), mais on veut le SAVOIR.
# Ce script relève l'ensemble des hôtes DISTINCTS stockés en base prod et envoie un e-mail
# (Resend, même chaîne que watch-containers.sh) uniquement quand cet ensemble change : un hôte
# apparaît (bascule, ou nouvelle organisation sur infra dédiée) ou disparaît. Une nouvelle connexion
# sur un hôte déjà connu ne déclenche rien.
#
# Installé dans /opt/backups/watch-apihosts.sh, cron toutes les 15 min (log /opt/backups/watch-apihosts.log).
# Premier passage : mémorise l'état de référence, sans e-mail.
#
# WATCH_DRY=1  ./watch-apihosts.sh → affiche les hôtes relevés, n'envoie rien, ne mémorise rien.
# WATCH_TEST=1 ./watch-apihosts.sh → envoie un e-mail de test (vérifie la chaîne d'alerte).
set -uo pipefail

ENV_PROD=/opt/apps/mytradingcoach/prod/.env.production
STATE=${WATCH_APIHOSTS_STATE:-/opt/backups/.watch-apihosts-state}   # surchargeable pour les tests
DB=mytradingcoach_prod

psql_prod() { docker exec mtc_postgres psql -U mtc_user -d "$DB" -tA -F ' ' -c "$1"; }

# Une ligne par hôte distinct : « clé=hôte ». Seules les connexions vivantes qui ont déjà lu leurs hôtes.
hosts=$(psql_prod "
  select distinct h.key || '=' || h.value
  from \"BrokerConnection\" b, jsonb_each_text(b.\"apiHosts\") h
  where b.provider = 'TRADOVATE' and b.status = 'CONNECTED' and b.\"apiHosts\" is not null
    and h.key in ('live', 'demo', 'reportingLive', 'reportingDemo')
  order by 1") || { echo "[apihosts] $(date -u +%FT%TZ) lecture base impossible"; exit 1; }

# Contexte pour l'e-mail : quels logins sont sur quel hôte demo / reporting demo.
detail() {
  psql_prod "
    select coalesce(b.\"apiHosts\"->>'demo', '?') || ' · ' || coalesce(b.\"apiHosts\"->>'reportingDemo', '?')
           || ' ← login ' || coalesce(b.\"externalUserId\", '?') || ' (' || count(*) || ' connexion(s))' as ligne
    from \"BrokerConnection\" b
    where b.provider = 'TRADOVATE' and b.status = 'CONNECTED' and b.\"apiHosts\" is not null
    group by b.\"externalUserId\", b.\"apiHosts\"->>'demo', b.\"apiHosts\"->>'reportingDemo'
    order by ligne"
}

send() { # $1 sujet, $2 corps
  local key; key=$(grep -m1 '^RESEND_API_KEY=' "$ENV_PROD" | cut -d= -f2- | tr -d '"')
  SUBJECT="$1" BODY="$2" KEY="$key" python3 - <<'PY'
import json, os, urllib.error, urllib.request
req = urllib.request.Request(
    "https://api.resend.com/emails",
    data=json.dumps({
        "from": "noreply@mytradingcoach.app",
        "to": "hello@mytradingcoach.app",
        "subject": os.environ["SUBJECT"],
        "text": os.environ["BODY"],
    }).encode(),
    # User-Agent explicite : Cloudflare (devant Resend) refuse celui de Python-urllib (403).
    headers={"Authorization": "Bearer " + os.environ["KEY"], "Content-Type": "application/json",
             "User-Agent": "mtc-watch-apihosts/1.0"},
)
try:
    print("[apihosts] e-mail", urllib.request.urlopen(req, timeout=15).status)
except urllib.error.HTTPError as e:
    print("[apihosts] e-mail REFUSÉ", e.code, e.read().decode()[:300])
    raise SystemExit(1)
PY
}

now=$(date -u '+%d/%m/%Y %H:%M UTC')
if [ "${WATCH_DRY:-0}" = 1 ]; then
  echo "[apihosts] $now"; echo "$hosts"; echo "--"; detail; exit 0
fi
if [ "${WATCH_TEST:-0}" = 1 ]; then
  send "✅ Test alerte apiHosts Tradovate" "Chaîne d'alerte opérationnelle ($now).

Hôtes relevés :
$hosts"
  exit 0
fi

# Aucune connexion vivante avec hôtes : rien à comparer, on garde l'état connu.
[ -z "$hosts" ] && exit 0

if [ ! -f "$STATE" ]; then
  printf '%s' "$hosts" > "$STATE"
  echo "[apihosts] $now état de référence mémorisé : $(echo "$hosts" | tr '\n' ' ')"
  exit 0
fi

previous=$(cat "$STATE")
[ "$hosts" = "$previous" ] && exit 0   # rien de nouveau : pas d'e-mail

added=$(comm -13 <(echo "$previous") <(echo "$hosts"))
removed=$(comm -23 <(echo "$previous") <(echo "$hosts"))
body="$now

Les hôtes Tradovate stockés sur les connexions ont changé (NinjaTrader a probablement basculé une
prop firm sur une autre infra). L'API suit seule : REST, WebSocket et reporting partent déjà sur les
nouveaux hôtes. À vérifier : la synchro suivante des connexions concernées réussit.

Nouveaux :
${added:-—}

Disparus :
${removed:-—}

Répartition actuelle (demo · reporting demo ← login) :
$(detail)

Logs : docker logs mtc_api_prod_worker --since 1h 2>&1 | grep -E 'apiHosts|Tradovate'
Contexte : ticket #286, apps/api-mytradingcoach/src/modules/integrations/tradovate/tradovate-hosts.ts"
# L'état n'est mémorisé qu'après un envoi réussi : sinon l'alerte serait perdue, on réessaie au passage suivant.
send "🔀 Tradovate : hôtes API modifiés ($(echo "$added" | sed '/^$/d' | wc -l) nouveau(x))" "$body" \
  && printf '%s' "$hosts" > "$STATE"
