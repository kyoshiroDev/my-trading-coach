attaque le #1278

Texte de l'issue #1278 : Idée remontée par le relecteur (#1276) : ajouter `restart: true` sous `depends_on.postgres` du service pgbouncer (`infra/prod/databases/docker-compose.yml` + serveur), pour que compose relance PgBouncer quand Postgres est recréé (incident du 2026-11-25, #1273). Domaine deploy, application sur le VPS par Greg.
