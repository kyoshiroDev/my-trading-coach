# Tests de charge (PROMPT-136)

Outils de l'audit `docs/audits/capacite-10k.md`. **Non branchés à la CI.**

> ⚠️ **JAMAIS contre la prod.** Uniquement une base / une API **dev** (ou une réplique locale).
> Le seed refuse toute base dont le nom ne contient pas `dev`, `load` ou `test` ; k6 refuse toute
> `BASE_URL` autre que `localhost`, `dev.*` ou `beta.*`.
> Côté API testée : `AI_ENABLED=false`, clés Stripe **test**, pas de connexion Tradovate, Resend
> neutralisé.

| Fichier | Rôle |
|---|---|
| `seed/seed-load.sh` + `seed-load.sql` | 10 000 users `loadtest-NNNNN@loadtest.invalid` (mot de passe `LoadTest!2026`), ~2,2 M trades répartis inégalement, setups, comptes, sessions. Idempotent (~5 min). |
| `seed/clean-load.sql` (`seed-load.sh --clean`) | Supprime tout le jeu de test. |
| `k6/us-open.js` | Scénario « ouverture US » : 100 → 250 → 500 → 1 000 VU, 5 min par palier. |
| `monitor.sh` | CPU / mémoire par groupe de process, connexions PG, Redis, files BullMQ (CSV). |
| `analyze.py` | Latences p50/p95/p99 et erreurs par endpoint et par palier depuis le CSV k6. |

```bash
# 1. Seed (base dev uniquement)
LOAD_TEST_DATABASE_URL=postgresql://…/mtc_dev ./tools/load-tests/seed/seed-load.sh

# 2. (réplique locale sans accès sortant) : pré-remplir le cache marché pour ne pas appeler Yahoo
redis-cli set market:context '{"nq":{"value":18500,"changePct":0.4,"source":"yahoo"}, …}'
redis-cli set price:NQ 18500.25

# 3. Test + mesures
PGURL=postgresql://…/mtc_dev ./tools/load-tests/monitor.sh > /tmp/mon.csv &
k6 run --out csv=/tmp/k6.csv -e BASE_URL=https://dev.api.mytradingcoach.app/api tools/load-tests/k6/us-open.js
python3 tools/load-tests/analyze.py /tmp/k6.csv

# 4. Nettoyage
LOAD_TEST_DATABASE_URL=postgresql://…/mtc_dev ./tools/load-tests/seed/seed-load.sh --clean
```

Sur un hôte Docker, compléter `monitor.sh` par `docker stats --no-stream` à intervalle régulier.
Le throttler global compte 60 req/min **par IP** : k6 envoie un `X-Forwarded-For` distinct par VU,
ce qui n'est pris en compte que si l'API fait confiance au proxy (`trust proxy 1`) — derrière
Traefik, c'est Traefik qui écrase cet en-tête : lancer k6 depuis plusieurs machines, ou relever
temporairement la limite sur l'environnement dev.
