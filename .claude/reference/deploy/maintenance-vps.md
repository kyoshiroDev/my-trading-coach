# Maintenance des VPS

> Contenu déplacé à l'identique depuis `.claude/agents/deploy.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : deploy.md · Maintenance des VPS (2026-10-16) · 2026-10-16 -->
> **Origine** : `deploy.md` · « Maintenance des VPS (2026-10-16) » · 2026-10-16

## Maintenance des VPS (2026-10-16)

| | Ancien VPS `51.83.197.230` (dev, beta, landing, admin) | VPS prod `149.202.40.240` |
|---|---|---|
| MAJ sécurité | unattended-upgrades | unattended-upgrades (Docker en liste noire) |
| Reboot | **auto à 05:00** si requis (`52unattended-upgrades-local`) | **jamais auto** (`52mtc-unattended`) → alerte e-mail `watch-containers.sh`, reboot planifié à la main |
| sudo | mot de passe → Greg lance les commandes dans SON terminal | mot de passe (NOPASSWD de la migration retiré le 2026-10-17) |

Procédure : audit en lecture seule (`uptime`, `/var/run/reboot-required.pkgs`, `apt list --upgradable`,
`docker system df`, volumes sans conteneur, mtime des logs cron) → nettoyage → `apt-get full-upgrade`
(la MAJ de `docker-ce`/`containerd` redémarre tous les conteneurs ≈ 1 min, ils remontent grâce à
`unless-stopped`) → reboot → vérifier `uptime`, noyau, `docker ps`, `WATCH_DRY=1 watch-containers.sh`,
les URL publiques. Commandes sudo données à Greg : **courtes et sans guillemets imbriqués** (déposer
les fichiers dans `~` d'abord) ; une longue chaîne collée a été tronquée et le reboot n'est jamais parti.

### Mettre à jour une image (nginx, Traefik…) — appliqué le 2026-11-22 (faille nginx2root)

Versions : les fichiers compose font foi, ne pas les recopier ici. **Prod épinglée** (tag précis dans
`infra/prod/…`, identique à `/opt/infra/<stack>/` sur le serveur) ; **ancien VPS en tags flottants**
(`nginx:alpine`, `traefik:v2.11`, compose hors dépôt dans `/opt/infra/static/` et `/opt/infra/traefik/`).

- Prod : `docker pull <image:tag>` (vérifier la version avec `docker run --rm <image> … version`) →
  copie datée à la minute du compose (`cp -p docker-compose.yml docker-compose.yml.bak-AAAAMMJJ-HHMM`)
  → changer le tag → `docker compose up -d` dans `/opt/infra/<stack>` → reporter le tag dans `infra/prod/…` (PR).
- Ancien VPS : `docker pull nginx:alpine` / `traefik:v2.11` → `docker compose up -d` dans `/opt/infra/static`
  (**les 2 fichiers** : `docker-compose.yml` et `docker-compose.beta.yml`) puis dans `/opt/infra/traefik`.
- Vérifier : version dans chaque conteneur (`docker exec <c> nginx -v`, `traefik version`), routes publiques en h2
  (www 302 → /prop-firm, vrai 404, admin, dev, beta, dev.api, app, `api/health`), logs Traefik sans erreur,
  date de fin du certificat (`openssl s_client … | openssl x509 -noout -enddate`).
- Aucun nginx ne publie de port : seul Traefik reçoit le trafic public (HTTP/2 terminé par Traefik).

### Avant un reboot de la prod

- **Dump manuel juste avant** (la sauvegarde auto date de 03:00) : même commande que `backup.sh`, fichier
  `mtc_prod_AAAAMMJJTHHMM_avant-reboot.sql.gz` dans `/opt/backups/mtc/`, vérifié par `gzip -t` et sa taille.
- Tous les conteneurs sont en `unless-stopped` : **ne pas les `docker stop` à la main** avant le reboot (ils ne
  remonteraient pas). Postgres s'arrête avec `SIGINT` (arrêt rapide de l'image) dans les 10 s accordées par Docker.
- Créneau calme (week-end, marchés fermés) : le reboot coupe l'API 1 à 2 min (blue/green ne protège pas d'un reboot de l'hôte).
- Après : `uptime` et noyau, `docker ps` (blue ou green actif, worker), `/api/health` puis `/api/health/ready`,
  `docker logs mtc_pgbouncer --tail=5`, `WATCH_DRY=1 /opt/backups/watch-containers.sh`.

Ancien VPS : `live-restore=false`, la MAJ de `docker-ce` coupe ≈ 1 min **aussi la landing www. et l'admin**.
Il redémarre seul à 05:00 si un reboot est requis : préférer le reboot manuel tout de suite, puis vérifier.

Ancienne prod retirée de l'ancien VPS le 2026-10-16 (images, `/opt/apps/mytradingcoach/prod`,
`/opt/static/app-prod`, service `app-prod` du compose static, prod de `backup.sh`/`backup-apps.sh`).
Base `mytradingcoach_prod` supprimée de son Postgres le même jour (dump final
`/opt/backups/mtc/mtc_prod_20261016_final.sql.gz`, `.env` dans `/opt/backups/ancienne-prod/`) ;
son `restore-test.sh` vérifie désormais la beta. Reste l'entrée `mytradingcoach_prod` dans `DATABASES`
de PgBouncer (sans effet, à retirer à la prochaine recréation de PgBouncer).
