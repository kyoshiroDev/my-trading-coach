# Tests de charge k6 (SCA-B0-10)

Scénarios du plan scalabilité 10k (`docs/prompts/scalabilite-10k-2026-09-30.md`). **Jamais contre
la prod** : `common.js` refuse `api.mytradingcoach.app` sauf `ALLOW_PROD=oui-je-sais`.

| Script | Scénario | Quand |
|---|---|---|
| `smoke.js` | 1 utilisateur, parcours complet (inscription, dashboard, journal, polling) | avant tout le reste |
| `signup-wave.js` | 30 inscriptions/min pendant 10 min (jour J) | SCA-B9-02 |
| `peak.js` | montée 200 → 500 → 1 000 → 1 500 utilisateurs, palier de 15 min | SCA-B9-01 / B9-03 |

## Lancer (k6 est un binaire, pas de pnpm)

```sh
# depuis la racine du dépôt
# les variables passent par l'option -e de k6 (pas celle de docker)
docker run --rm -i -v "$PWD/tools/load:/scripts" grafana/k6 run \
  -e BASE_URL=https://beta.api.mytradingcoach.app/api /scripts/smoke.js

# pic, avec les comptes de charge du seed beta
docker run --rm -i -v "$PWD/tools/load:/scripts" grafana/k6 run \
  -e BASE_URL=https://beta.api.mytradingcoach.app/api \
  -e LOAD_USER_COUNT=20 -e LOAD_EMAIL_PATTERN='load-{i}@test.local' -e LOAD_PASSWORD='…' \
  /scripts/peak.js
```

**En parallèle, sur le VPS** : `watch -n 5 docker stats --no-stream` (mémoire et CPU par conteneur).
À relever : p50 / p95 / p99, taux d'erreur, pic mémoire de `mtc_api_beta`, redémarrages éventuels.

## Procédure B9 complète (pic sur beta)

Machine partagée avec la prod : **hors heures du marché US** (15 h 30 – 22 h Paris), et
**purger avant 3 h** (sinon la sauvegarde nocturne embarque ~4 Go de beta vers B2).

1. **Clé de test** sur beta : `LOAD_TEST_KEY=<openssl rand -hex 24>` dans `.env.beta`, recréer
   l'API beta. Ignorée si l'API vise la base de prod (garde-fou dans le code).
2. **Beta au format prod** le temps du test : `DB_POOL_MAX=5` dans `.env.beta`, pool PgBouncer de
   beta à 20, API dev arrêtée (budget de connexions, voir `deploy.md`). Remettre 2 / 6 après.
3. **Jeu de données** (≈ 4,1 M trades, ~1,5 Go, ~11 min) :
   ```sh
   HASH=$(cd apps/api-mytradingcoach && node -e "require('argon2').hash('LoadTest-2026!',{type:2,memoryCost:19456,timeCost:2,parallelism:1}).then(console.log)")
   # le hash contient des « $ » : il ne doit JAMAIS passer dans une commande ssh entre guillemets
   # (le shell distant les interprète). On le transmet dans le SQL, par l'entrée standard :
   { printf '\\set pwhash %s\n' "'$HASH'"; cat tools/load/seed-beta.sql; } |
     ssh greg@VPS 'docker exec -i mtc_postgres psql -U mtc_user -d mytradingcoach_beta -v users=2000'
   ```
4. **Mesures serveur** : `nohup /opt/backups/collect-metrics.sh /opt/backups/charge-<date>.csv &`
5. **Injection** (le mot de passe des comptes est `LoadTest-2026!`) :
   ```sh
   docker run --rm -i -v "$PWD/tools/load:/scripts" grafana/k6 run --summary-export=/scripts/resultat.json \
     -e BASE_URL=https://beta.api.mytradingcoach.app/api -e LOAD_TEST_KEY=<clé> \
     -e LOAD_USER_COUNT=2000 /scripts/peak.js
   ```
6. **Nettoyage** : `purge-beta.sql`, retirer `LOAD_TEST_KEY`, remettre `DB_POOL_MAX=2` et le pool
   beta à 6, relancer l'API dev.

## ⚠️ Limites de débit : un seul injecteur mesure le throttler, pas l'API

**Résolu par `LOAD_TEST_KEY`** (SCA-B9) : chaque VU envoie la clé et `x-load-client: vu-<n>`,
l'API le compte comme un client distinct (les limites restent actives, par client). Sans clé,
le tableau ci-dessous s'applique.


Toutes les requêtes d'un injecteur viennent de la **même IP**, et l'API limite par IP :

| Limite | Valeur | Effet sur les scénarios |
|---|---|---|
| Globale | 60 req/min/IP | `peak.js` plafonné à 1 req/s au total |
| Connexion | 30 / 10 min / IP | `peak.js` se connecte une fois par compte (`setup`) et partage les jetons |
| Inscription | 10 / h / IP | `signup-wave.js` reçoit 429 dès la 11ᵉ inscription |

`X-Forwarded-For` ne contourne rien (le proxy de confiance ajoute l'IP réelle) : c'est voulu.


## Après un test

Les inscriptions de test ont des e-mails `load-*@test.local` : les purger de la base **beta**.
