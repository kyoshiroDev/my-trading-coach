# VPS prod — `greg@149.202.40.240` (`mtc-prod`)

Machine dédiée à la **production** (migration du 2026-10-15). L'ancien VPS `51.83.197.230` ne porte
plus que dev et beta. Landing et admin sont sur Vercel.

Ce dossier est la **copie de référence** des fichiers installés sur le serveur. Ils ne sont pas
déployés automatiquement : modifier le dépôt **et** le serveur.

| Dépôt | Serveur |
|---|---|
| `traefik/` | `/opt/infra/traefik/` (+ `.env.traefik`, identifiants OVH du challenge DNS, 600) |
| `databases/` | `/opt/infra/databases/` (+ `.env`, 600, et `pgbouncer-auth/userlist.txt`, 600, uid 70) |
| `backups/backup.sh` | `/opt/backups/mtc/backup.sh` |
| `backups/offsite.sh`, `backups/restore-test.sh` | `/opt/backups/` (+ `offsite.env`, 600) |
| `crontab` | `crontab -l` de greg |
| `static-docker-compose.yml` | `/opt/infra/static/docker-compose.yml` (app Angular prod seule) |
| `bascule/` | `/opt/infra/bascule/` — scripts de la bascule (procédure : `docs/ops/bascule-vps-prod.md`) |

Le dépôt est cloné dans `/opt/apps/mytradingcoach/prod` (clé de lecture GitHub
`~/.ssh/github_deploy_mtc`, clé de déploiement « mtc-prod-vps-clone »). `authorized_keys` de greg :
ta clé, `github-actions-mtc-prod` (CD, secret `PROD_VPS_SSH_KEY`) et `mtc-api-prod-admin` (pages
VPS de l'admin : clé dans `VPS_SSH_KEY_B64`, acceptée seulement depuis les réseaux Docker
`172.16.0.0/12`, sans pty ni redirection ; privée dans `/opt/apps/mytradingcoach/prod-secrets/`).

## Système

- Ubuntu 26.04 LTS, fuseau Europe/Paris, swap 4 Gio (`vm.swappiness=10`), durcissement réseau et
  noyau dans `/etc/sysctl.d/99-mtc-hardening.conf`.
- **SSH** : `/etc/ssh/sshd_config.d/00-mtc-hardening.conf` (lu en premier, la première valeur gagne) :
  clé seule, root interdit, `AllowUsers greg`, `MaxAuthTries 3`. Le compte `ubuntu` est verrouillé.
- **UFW** : entrée refusée sauf 22, 80, 443. Le 22 est en `allow` et non en `limit` : un déploiement
  CI ouvre plusieurs connexions de suite et `limit` les rejetterait.
- **fail2ban** (`/etc/fail2ban/jail.d/mtc.local`) : jail sshd, bannissement par UFW, durée croissante
  jusqu'à 1 semaine. L'ancien VPS est en `ignoreip` : voie de secours si ton IP est bannie
  (`ssh -A greg@51.83.197.230` puis `ssh greg@149.202.40.240`, et
  `sudo fail2ban-client set sshd unbanip <ip>`). Ne pas multiplier les tests de connexion ratés.
- **unattended-upgrades** : correctifs de sécurité seuls, jamais de redémarrage automatique, paquets
  Docker exclus (ils redémarreraient les conteneurs). Docker et noyau : à la main, en maintenance.
- **Docker** : `/etc/docker/daemon.json` → rotation des logs, `live-restore`, et `"ip": "127.0.0.1"` :
  un port publié sans IP n'écoute qu'en local, donc une base ne peut pas être exposée par erreur
  (Docker contourne UFW). Traefik publie explicitement `0.0.0.0:80` et `0.0.0.0:443`.
  Groupe `docker` = gid 986 (112 sur l'ancien VPS).

## Traefik

v3, sans accès direct au socket Docker : il passe par `docker-socket-proxy` (lecture seule, réseau
interne `mtc_socket`). Pas de dashboard. TLS ≥ 1.2, en-têtes de sécurité (`security-headers@file`)
sur tout `websecure`. Certificats Let's Encrypt par **challenge DNS OVH** : un certificat s'obtient
avant que le DNS pointe ici (utile pour préparer une bascule).

## Bases

- `mtc_postgres` (17) : `mtc_admin` = superuser (administration seulement) ; `mtc_user` = rôle de
  l'API, **non superuser**, propriétaire de `mytradingcoach_prod` (migrations Prisma et `pg_dump`
  OK) ; `mtc_readonly` = lecture seule, utilisable uniquement par `docker exec` (local trust).
  Sommes de contrôle des données actives. Publié sur `127.0.0.1:5432` seulement (tunnel SSH).
- `mtc_pgbouncer` : seule la base prod (pool 25, `max_db_connections` 40 sur `max_connections` 50).
  Si le mot de passe de `mtc_user` change, régénérer `userlist.txt` (voir `.claude/agents/deploy.md`).
- `mtc_redis` (7.4) : AOF activé (les jobs BullMQ survivent à un redémarrage), `noeviction`.
  L'API prod n'a besoin ni de `REDIS_DB` ni de `REDIS_PREFIX`.

Chaînes de connexion de l'API (`.env.production`) :

```bash
DATABASE_URL=postgresql://mtc_user:<MTC_USER_PASSWORD>@mtc_pgbouncer:6432/mytradingcoach_prod?pgbouncer=true&connection_limit=1
DATABASE_DIRECT_URL=postgresql://mtc_user:<MTC_USER_PASSWORD>@mtc_postgres:5432/mytradingcoach_prod
REDIS_HOST=mtc_redis
REDIS_PASSWORD=<REDIS_PASSWORD>
```

## Sauvegardes

- 3 h 00 : `backup.sh` → `/opt/backups/mtc/mtc_prod_*_auto.sql.gz` (14 jours, lu par l'admin).
- 3 h 45 : `offsite.sh` → restic chiffré → B2, bucket `mtc-backups-7k3q9x`, **dépôt `prod`** (séparé
  du dépôt de l'ancien VPS ; même clé B2 limitée au bucket, même `RESTIC_PASSWORD`).
- `restore-test.sh` : restaure le dernier instantané dans un Postgres jetable et compare à la prod.
  À lancer après la bascule, puis au moins une fois par trimestre.

## Sudo

Pendant la migration, `/etc/sudoers.d/90-greg-setup` donne sudo sans mot de passe. À supprimer une
fois la prod basculée : sudo demande alors le mot de passe de greg.
