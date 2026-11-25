fait la PR de doc pour pgbouncer

Contexte (ajouté par la session) : suite de #1273. Le 2026-11-25, la recréation de `mtc_postgres` sur le VPS prod (nouvelles limites mémoire) a laissé PgBouncer sur l'ancienne IP de Postgres : API en 503 « Indisponible : database » ~75 s, réglé par `docker restart mtc_pgbouncer`. Documenter la consigne dans les références deploy.
