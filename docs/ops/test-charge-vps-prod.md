# Test de charge sur le VPS prod — point de rupture de la machine

> Rédigée le 2026-10-17 (premier passage le même jour). Objectif : mesurer combien d'utilisateurs
> simultanés le VPS prod (6 vCores, 12 Go) encaisse, pour comparer aux ~1 000 de l'ancien VPS
> (B9-01) et aux 1 500 tenus sur beta (test n° 6). Résultats : section 5.

## 1. Principe

- **Jamais l'API ni la base de prod.** Un environnement jetable tourne **sur la même machine**
  (`infra/prod/load/docker-compose.load.yml`) : Postgres, PgBouncer, Redis et API dédiés, mêmes
  images et réglages que la prod, sur un réseau interne que la prod ne voit pas. Il partage le CPU,
  la RAM et le disque — ce qu'on mesure — sans toucher aux données, aux connexions ni au Redis de la
  prod (un Redis plein bloquerait ses files).
- Secrets tirés au hasard (`make-env.sh`), clés externes factices : aucun e-mail, paiement, appel IA
  ou Tradovate possible. Conteneurs `load_*` : la supervision de la prod les ignore.
- **Injecteur : l'ancien VPS** (4 cœurs au repos, même réseau OVH), k6 bridé à 3 cœurs / 4,5 Go
  pour ne pas gêner landing, admin, dev et beta qui y tournent.
- **Chien de garde** (`garde-fou.sh`, sur l'injecteur) : sonde la vraie prod toutes les 5 s, arrête
  k6 si son p95 sur 1 min dépasse 500 ms deux fois de suite, ou après 3 échecs.
- Créneau : marchés fermés (week-end) ou hors 15 h 30 – 22 h ; PC de Greg allumé (Claude pilote).

## 2. Préparation (≈ 30 min)

```sh
# [L] fichiers
ssh greg@149.202.40.240 'install -d -m 700 /opt/infra/load'
scp infra/prod/load/{docker-compose.load.yml,make-env.sh,mesures.sh} tools/load/seed-beta.sql greg@149.202.40.240:/opt/infra/load/
ssh greg@51.83.197.230 'install -d -m 700 ~/charge' && scp tools/load/*.js infra/prod/load/garde-fou.sh greg@51.83.197.230:charge/

# [P] environnement (image = celle de la couleur prod en service)
cd /opt/infra/load && bash make-env.sh mtc_api_prod:<sha12>
dc() { docker compose -p mtcload -f docker-compose.load.yml --env-file .env "$@" </dev/null; }   # </dev/null : sinon `run` avale un script lu sur stdin
dc up -d postgres pgbouncer redis
dc run --rm --no-deps -l traefik.enable=false api migrate
dc up -d api      # certificat load.api.mytradingcoach.app par challenge DNS, sans enregistrement

# [P] jeu de données : 3 000 comptes Premium, ≈ 6 M trades (~15 min, en arrière-plan)
HASH=$(docker exec load_api node -e "require('argon2').hash('LoadTest-2026!',{type:2,memoryCost:19456,timeCost:2,parallelism:1}).then(console.log)")
{ printf '\\set pwhash %s\n' "$HASH"; cat seed-beta.sql; } > /tmp/seed-load.sql
nohup sh -c 'docker exec -i load_postgres psql -U mtc_user -d mytradingcoach_load -v users=3000 < /tmp/seed-load.sql > seed.log 2>&1' &
```

## 3. Test

```sh
# [P] mesures (CSV toutes les 15 s)
nohup bash /opt/infra/load/mesures.sh /opt/infra/load/mesures-$(date +%Y%m%d-%H%M).csv >/dev/null 2>&1 &

# [A] k6 + chien de garde (clé : grep LOAD_TEST_KEY /opt/infra/load/.env.api sur [P])
cd ~/charge
docker run -d --name k6-charge --cpus 3 --memory 4500m --add-host load.api.mytradingcoach.app:149.202.40.240 \
  -v "$PWD:/scripts" grafana/k6:2.2.0 run --summary-export=/scripts/resultat.json \
  -e BASE_URL=https://load.api.mytradingcoach.app/api -e LOAD_TEST_KEY=<clé> -e LOAD_USER_COUNT=3000 \
  -e HOLD_MIN=5 -e PEAKS=2000,2500,3000,3500,4000 -e PEAK_HOLD_MIN=5 /scripts/peak.js
nohup bash garde-fou.sh k6-charge 0.5 >> garde-fou.log 2>&1 &
```

Montée : 200 → 500 → 1 000 → 1 500 (5 min), puis +500 toutes les 8 min jusqu'à 4 000 (~64 min au
maximum). **Point de rupture** = premier palier où, sur l'API de test, le p95 dépasse 1 s ou les
erreurs dépassent 1 %, ou bien où le débit baisse quand les utilisateurs augmentent. Mesure minute
par minute dans le journal d'accès Traefik (`docker logs mtc_traefik | grep load-api@docker`).

Puis vague d'inscriptions (#487) : `signup-wave.js` (30/min, 10 min), même `docker run`.

## 4. Nettoyage (obligatoire, ≈ 5 min)

```sh
# [L] D'ABORD rapatrier les résultats, un fichier par argument (pas d'accolades distantes avec scp)
scp greg@149.202.40.240:/opt/infra/load/mesures-<date>.csv greg@51.83.197.230:charge/out/resultat.json .
# [A]  (motifs entre crochets : sinon pkill tue la session ssh qui le lance)
docker rm -f k6-charge k6-signup; pkill -f '[g]arde-fou.sh k6'; rm -rf ~/charge
# [P]
pkill -f '[m]esures.sh /opt'
cd /opt/infra/load && docker compose -p mtcload -f docker-compose.load.yml --env-file .env down -v </dev/null
rm -f /tmp/seed-load.sql && cd / && rm -rf /opt/infra/load
# Traefik garde le certificat load.api dans acme.json (inoffensif, expire seul).
```

## 5. Résultats

### Passage n° 1 — samedi 17/10/2026, 12 h 08 – 12 h 55 (marchés fermés)

Conditions : image prod `1a67cbde987a`, API de test 3 workers / `DB_POOL_MAX` 5 / 2 Go, 3 000 comptes
Premium, 6 120 000 trades (base 2,4 Go). `peak.js` : paliers 200 · 500 · 1 000 · 1 500 (5 min) puis
2 000 · 2 500 · 3 000 · 3 500 · 4 000 (5 min chacun). Injecteur : ancien VPS (k6 2.2.0, ≤ 27 % CPU,
≤ 1,7 Go : jamais limitant).

| Utilisateurs simultanés | Requêtes / min | p50 | p95 | p99 | Erreurs 5xx | Charge (6 cœurs) | CPU API test | Prod (sonde) |
|---|---|---|---|---|---|---|---|---|
| 200 | 2 000 | 8 ms | 16-21 ms | 25-63 ms | 0 | 2,1 | 0,75 cœur | ~100 ms |
| 500 | 5 000 | 8-9 ms | 17-22 ms | 23-65 ms | 0 | 1,3 | 1,1 | ~100 ms |
| 1 000 | 10 000-11 500 | 8-10 ms | 20-27 ms | 29-68 ms | 0 | 3,0 | 1,8 | ~130 ms |
| 1 500 | 15 000 | 9 ms | 22-26 ms | 31-62 ms | 0 | 3,0 | 1,2-1,8 | 120-180 ms |
| 2 000-2 200 | 17 600-22 600 | 14-19 ms | 41-76 ms | 73-135 ms | 0 | 6-8 | 2,8 | ~150 ms |
| **2 500** | **25 000-26 000** | **17-21 ms** | **55-78 ms** | **96-146 ms** | **0** | 7,6-9 | 2,3-2,8 | 160-230 ms |
| 2 700-3 000 | 27 000-31 000 | 35-114 ms | 155-534 ms | 245-848 ms | 0 | 10-11,4 | 2,1-3 | 230-300 ms |
| **≈ 3 100 (rupture)** | **24 100 ↓** | **713 ms** | **2,7 s** | **3,9 s** | 0 | 12,7 | **3,0 (plafond)** | **2,3 s** |

- **Arrêt** à 12 h 54 min 50 par le chien de garde (prod à 2,3 s), k6 arrêté à la main 11 s après.
  Prod revenue à 70-170 ms dans la minute.
- **Aucune erreur serveur** sur 421 338 requêtes journalisées (10 h 39 – 10 h 56 UTC ; le début est
  sorti de la rotation des journaux Traefik) : 200/201, plus 5 388 × 401 (jetons de 15 min
  renouvelés par le scénario) et 708 × 499 (requêtes coupées à l'arrêt). 0 redémarrage, 0 OOM,
  0 requête Postgres > 500 ms, 0 attente dans PgBouncer (15/15 connexions serveur dès 1 500).

**Conclusions**

1. **Capacité confortable : ~2 500 utilisateurs simultanés** (≈ 420 req/s, p95 < 80 ms, 0 erreur).
   Dégradée mais sans erreur jusqu'à ~3 000 (p95 jusqu'à 0,5 s). **Rupture vers 3 100** : le débit
   baisse quand la charge monte. Ancien VPS (B9-01) : ~1 000 ; beta (test n° 6) : 1 500 tenus.
   Avec le scénario (bien plus actif qu'un vrai utilisateur), 2 500 simulés ≈ 5 000 à 8 000 vrais
   connectés : **largement de quoi porter 10 000 inscrits**.
2. **Goulot : le CPU de l'API** (3 workers Node, plafond 3 cœurs atteint à la rupture), puis la
   machine entière (charge 12,7 pour 6 cœurs : Postgres de test ~1 cœur, Traefik ~1 cœur). La base,
   PgBouncer et Redis ne limitent pas.
3. **Biais du test** : l'environnement de test (sa propre base, son Redis) s'ajoute à la prod sur la
   même machine. En vrai, une seule base et un seul Redis servent tout le monde : la capacité réelle
   est un peu supérieure à ces chiffres.
4. **Leviers si besoin** (non nécessaires aujourd'hui) : `WEB_CONCURRENCY` 4-5 (la machine a 6
   cœurs, l'API n'en utilise que 3), `DB_POOL_MAX` 6-8 en même temps (pool PgBouncer 25 à revoir).

Résumé k6 : 804 307 requêtes en 47 min, p50 43 ms, p95 239 ms (rupture comprise), 1,2 % « en
échec » côté k6 = 401 de jetons expirés et 499 de l'arrêt (aucun 5xx vu par Traefik).

**Vague d'inscriptions (#487)**, juste après, 30/min pendant 10 min : 199 inscriptions en 201
(p50 67 ms, p95 91 ms, max 134 ms, hachage argon2 compris), prod inchangée (~110 ms). Les 102 × 429
sont un **artefact** : `signup-wave.js` envoie `x-load-client: vu-<n>` (20 VU) et la limite
d'inscription est de 10/h par client → 200 au plus. À corriger avant le prochain passage : un
identifiant de client par inscription, pas par VU.

**Incidents du passage** : (1) PR #575 (`dev` → `main`) mergée à 12 h 51, la CD a redéployé l'API
prod (blue → green) vers 13 h 02, pendant la vague d'inscriptions : sans effet sur le test (API de
test séparée), bascule sans coupure. (2) Le CSV de `mesures.sh` a été supprimé avec
`/opt/infra/load` avant d'être rapatrié (`scp` avec accolades distantes) : la courbe à 15 s est
perdue, les chiffres ci-dessus viennent des points d'étape et du journal Traefik. Au prochain
passage, rapatrier fichier par fichier **avant** `rm -rf`. (3) `pkill -f garde-fou.sh` lancé par
ssh tue sa propre session (le motif est dans sa ligne de commande) : utiliser
`pkill -f '[g]arde-fou.sh k6'`.
