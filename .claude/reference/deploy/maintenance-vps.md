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

Ancienne prod retirée de l'ancien VPS le 2026-10-16 (images, `/opt/apps/mytradingcoach/prod`,
`/opt/static/app-prod`, service `app-prod` du compose static, prod de `backup.sh`/`backup-apps.sh`).
Base `mytradingcoach_prod` supprimée de son Postgres le même jour (dump final
`/opt/backups/mtc/mtc_prod_20261016_final.sql.gz`, `.env` dans `/opt/backups/ancienne-prod/`) ;
son `restore-test.sh` vérifie désormais la beta. Reste l'entrée `mytradingcoach_prod` dans `DATABASES`
de PgBouncer (sans effet, à retirer à la prochaine recréation de PgBouncer).
