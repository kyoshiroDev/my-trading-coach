# Jour J du lancement et tests de charge

> Contenu déplacé à l'identique depuis `.claude/agents/deploy.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : deploy.md · Jour J du lancement (SCA-B7-06) · 2026-10-01 -->
> **Origine** : `deploy.md` · « Jour J du lancement (SCA-B7-06) » · 2026-10-01

## Jour J du lancement (SCA-B7-06)

Procédure complète : `docs/ops/jour-j.md` (J-1, gel `FREEZE_API_DEPLOY`, arrêt de dev/beta,
surveillance, correctif urgent pendant le gel, retour à la normale).
Tableau de bord : `infra/monitoring/etat-prod.sh`, installé dans `/opt/backups/` (lecture seule,
`watch -n 30 /opt/backups/etat-prod.sh`) : mémoire des conteneurs, `/health/ready`, 5xx/429 des
10 dernières min, file d'attente PgBouncer, connexions et requêtes lentes Postgres, mémoire Redis,
disque — chaque ligne OK ou ⚠️ avec son seuil. Le mot de passe PgBouncer est lu dans le compose
des bases (3 occurrences sur la ligne `DATABASES` : n'en garder qu'une).

<!-- Origine : deploy.md · Tests de charge (SCA-B9, 2026-10-01) · 2026-10-01 -->
> **Origine** : `deploy.md` · « Tests de charge (SCA-B9, 2026-10-01) » · 2026-10-01

## Tests de charge (SCA-B9, 2026-10-01)

Procédure : `tools/load/README.md`. Variable **`LOAD_TEST_KEY`** (optionnelle, ≥ 32 caractères,
**beta uniquement**, à retirer après le test) : une requête qui la présente (`x-load-test-key`)
est limitée par client virtuel (`x-load-client`) au lieu de l'IP de l'injecteur. Le code
l'**ignore si `DATABASE_URL` vise `mytradingcoach_prod`**. Jeu de données : `seed-beta.sql` /
`purge-beta.sql` (refusent toute autre base que beta). Pendant un test : beta en format prod
(`DB_POOL_MAX=5`, pool PgBouncer beta 20, API dev arrêtée), hors heures du marché US, purge
avant la sauvegarde de 3 h.
