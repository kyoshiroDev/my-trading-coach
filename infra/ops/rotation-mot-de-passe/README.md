# Rotation du mot de passe de `mtc_user` (VPS prod) — modèle

Archive des scripts utilisés le **16/10/2026** sur le VPS prod (`149.202.40.240`), copiés depuis
`~/rotation` et `~/rotation2` de greg. Ils servent de **modèle** pour la prochaine rotation : ne pas
les lancer tels quels.

| Dossier | Usage | Coupure mesurée |
|---|---|---|
| `2026-10-16-rotation-1/` | 1re rotation (23 h 05), couleur active supposée `blue` | 51 s |
| `2026-10-16-rotation-2/` | 2e rotation (23 h 31), **indépendante de la couleur** : à reprendre en priorité | 47 s |

Déroulé, décisions et vérifications : `docs/ops/maintenance-2026-10-17.md`.

## Ce que font les scripts

`phase2.sh` (lancé en arrière-plan : `setsid nohup bash phase2.sh > phase2.log 2>&1 < /dev/null &`) :

0. Contrôles **sans rien modifier** (`--controles` s'arrête là) : une seule couleur d'API, healthy ;
   URL préparées ; dry-run `docker compose … up -d --no-deps pgbouncer` sans Postgres ; journalisation
   Postgres (`log_statement`, durée, erreurs, `pg_stat_statements.track_utility`) et réglages de
   session vérifiés ; `sudo -n` ; `userlist.txt` actuel ; format du nouveau mot de passe ; nouveau mot
   de passe absent des journaux ; `SELECT 1` avec l'ancien.
1. Arrêt du worker. 2. `ALTER ROLE` (mot de passe sur l'entrée standard, session sans journalisation).
3. `.env` des bases et `.env.production` (même inode). 4. `userlist.txt` régénéré depuis `pg_authid`.
5. PgBouncer recréé **seul** (`--no-deps`). 6. `SELECT 1` avec le nouveau mot de passe, via PgBouncer
et en direct. 7. `deploy-api.sh prod <SHA>` (même image, blue/green), surveillé.

`rollback.sh` remet le mot de passe d'avant (copie d'avant), les fichiers, `userlist.txt` régénéré,
PgBouncer, et la couleur d'API d'avant (ou redéploie le même SHA si elle a déjà été drainée).

Arrêts automatiques : dry-run qui touche Postgres (avant toute modification) ; `SELECT 1` raté ;
service non rétabli 180 s après le début de la coupure.

## À adapter avant la prochaine fois

- **Plus de sudo sans mot de passe** sur le VPS prod (17/10/2026) : les `sudo -n`, `sudo test`,
  `sudo grep`, `sudo tee` et `sudo chown` échouent. Soit Greg valide sudo dans le terminal juste avant
  (`sudo -v`), soit réécrire ces étapes avec `docker run --rm -v …/pgbouncer-auth:/d alpine` (comme
  la procédure `userlist.txt` de `.claude/agents/deploy.md`).
- Chemins datés (`prod-secrets/rotation-20261016*`, `env-backups/rotation-20261016*`) et SHA à
  remplacer ; préparer à part le nouveau mot de passe (fichier 600, 40 caractères alphanumériques),
  les `.new` et les copies d'avant.

## Leçons

- **Jamais une valeur de secret dans une commande**, même par variable : `grep -F -f <fichier 600>`
  pour chercher un mot de passe, `-e NOM` sans valeur pour `docker exec`, entrée standard pour `psql`.
  Le 16/10, un `\set` psql mal quoté a recopié le mot de passe dans une erreur (écran + journal
  Postgres) : d'où la 2e rotation.
- `pg_stat_statements` (base `mytradingcoach_prod`) garde le texte des commandes utilitaires :
  `SET pg_stat_statements.track_utility = off` dans la session de l'`ALTER ROLE`.
- Le healthcheck de l'API (`/api/health`) ne teste pas la base : l'ancienne couleur reste dans
  Traefik jusqu'à son drain. La coupure se termine à « requêtes en cours » de `deploy-api.sh`, pas à
  « reçoit du trafic ».
