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

## ⚠️ Limites de débit : un seul injecteur mesure le throttler, pas l'API

Toutes les requêtes d'un injecteur viennent de la **même IP**, et l'API limite par IP :

| Limite | Valeur | Effet sur les scénarios |
|---|---|---|
| Globale | 60 req/min/IP | `peak.js` plafonné à 1 req/s au total |
| Connexion | 30 / 10 min / IP | `peak.js` se connecte une fois par compte (`setup`) et partage les jetons |
| Inscription | 10 / h / IP | `signup-wave.js` reçoit 429 dès la 11ᵉ inscription |

`X-Forwarded-For` ne contourne rien (le proxy de confiance ajoute l'IP réelle) : c'est voulu.
Avant SCA-B9, il faudra choisir : plusieurs IP d'injection, ou limites relevées sur **beta
uniquement** par variable. `peak.js` devient pertinent après SCA-B3-03 (limite par utilisateur
une fois connecté).

## Après un test

Les inscriptions de test ont des e-mails `load-*@test.local` : les purger de la base **beta**.
