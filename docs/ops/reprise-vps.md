# Runbook — Remonter le VPS de zéro

> **Quand l'utiliser** : le VPS est perdu (panne, disque mort, compte OVH bloqué) ou on change de
> machine. Rédigé le 2026-10-01 à partir de l'état réel du VPS (Ubuntu 24.04, Docker 29, Compose v5).
>
> ⚠️ **Jamais répété de bout en bout.** Seule la restauration de la base a été prouvée
> (`restore-test.sh`, 30/09). Faire une répétition sur un petit VPS de test avant d'en avoir besoin,
> et corriger ce document à chaque écart constaté.

## 0. Avant de commencer

**Durée estimée** : 2 à 4 h, dont une partie d'attente DNS.
**Perte de données** : tout ce qui s'est passé depuis la dernière sauvegarde (3 h du matin), soit
jusqu'à 24 h. Les trades Tradovate se réimportent depuis le broker, Stripe peut renvoyer ses
webhooks ; les saisies manuelles de la journée sont perdues.

**À avoir sous la main (gestionnaire de mots de passe) :**
| Quoi | Sert à |
|---|---|
| `RESTIC_PASSWORD` | déchiffrer la sauvegarde B2 — **sans lui, rien n'est récupérable** |
| Clé B2 `mtc-vps-restic` : keyID + applicationKey | lire le bucket `mtc-backups-7k3q9x` |
| Accès OVH Manager | nouvelle IP, DNS |
| Accès GitHub (admin du dépôt) | clé de déploiement, secrets Actions |
| Clé SSH perso | se connecter au nouveau VPS |

**Ce qui est restauré, et d'où :**
| Élément | Source |
|---|---|
| Bases prod, dev, beta | B2 → `data/mtc/mtc_<env>_<date>_auto.sql.gz` |
| `.env` des 3 environnements | B2 → `apps/<env>/.env.*` |
| `/opt/infra` (Postgres, PgBouncer, Redis, nginx, Traefik) | B2 → `infra/` |
| Crontab, scripts de sauvegarde | B2 → `data/crontab.current`, `data/*.sh` |
| Code (API, app, admin, landing, bot Discord) | GitHub |
| Fronts compilés | refaits par le CD (ou build local + rsync) |
| Certificats HTTPS | régénérés par Let's Encrypt (défi DNS OVH) |

## 1. Préparer le serveur (en root, une seule fois)

```sh
adduser greg && usermod -aG sudo greg
mkdir -p /home/greg/.ssh && cp ~/.ssh/authorized_keys /home/greg/.ssh/ && chown -R greg:greg /home/greg/.ssh
curl -fsSL https://get.docker.com | sh && usermod -aG docker greg
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
printf 'vm.swappiness=10\nnet.core.somaxconn=4096\n' > /etc/sysctl.d/99-mtc.conf && sysctl --system
mkdir -p /opt/{apps/mytradingcoach,infra,static,backups} && chown -R greg:greg /opt
```
Pare-feu : n'ouvrir que 22, 80 et 443. Se reconnecter en `greg` pour la suite.

## 2. Récupérer la sauvegarde B2

```sh
cd /opt/backups
# Scripts depuis GitHub (dossier infra/backups du dépôt)
curl -fsSLO https://raw.githubusercontent.com/kyoshiroDev/my-trading-coach/main/infra/backups/offsite.sh   # dépôt privé : scp depuis ton poste à la place
chmod +x offsite.sh
umask 077 && nano offsite.env   # RESTIC_REPOSITORY=b2:mtc-backups-7k3q9x:mtc, RESTIC_PASSWORD, B2_ACCOUNT_ID, B2_ACCOUNT_KEY
./offsite.sh snapshots                        # doit lister les instantanés
./offsite.sh restore latest /tmp/restauration
ls /tmp/restauration/{data/mtc,infra,apps}
```
✅ **Contrôle** : un dump `mtc_prod_*_auto.sql.gz` récent, les dossiers `infra/databases`,
`infra/static`, `infra/traefik`, et `apps/prod`, `apps/dev`, `apps/beta`.

> `offsite.sh` monte `/opt/infra` et `/opt/apps/mytradingcoach` : créer ces dossiers avant
> (étape 1). La restauration, elle, n'a besoin que d'`offsite.env`.

## 3. Remettre la configuration

```sh
cp -a /tmp/restauration/infra/. /opt/infra/
mkdir -p /opt/infra/traefik/conf.d            # monté par Traefik, vide aujourd'hui
chmod 600 /opt/infra/databases/.env.databases /opt/infra/traefik/.env.traefik
docker network create mtc_network
```

## 4. Bases de données

```sh
cd /opt/infra/databases
docker compose up -d                           # mtc_postgres, mtc_pgbouncer, mtc_redis
docker compose -f docker-compose.beta.yml up -d  # mtc_redis_beta
docker exec mtc_postgres pg_isready -U mtc_user
# init-db.sh crée prod et dev au premier démarrage ; beta est à créer :
docker exec mtc_postgres psql -U mtc_user -d postgres -c 'CREATE DATABASE mytradingcoach_beta;'
for env in prod dev beta; do
  dump=$(ls -1t /tmp/restauration/data/mtc/mtc_${env}_*_auto.sql.gz | head -1)
  echo "== $env ← $dump"
  gunzip -c "$dump" | docker exec -i mtc_postgres psql -q -U mtc_user -d mytradingcoach_$env
done
docker exec mtc_postgres psql -U mtc_user -d mytradingcoach_prod -Atc 'SELECT count(*) FROM "User"; SELECT count(*) FROM "Trade";'
```
✅ **Contrôle** : les comptes de users et de trades correspondent au dernier dump (voir
`restore-test.sh`). Aucune ligne `ERROR` pendant le chargement.

⚠️ PgBouncer écoute sur **6432** (pas 5432) : les `DATABASE_URL` des `.env` pointent déjà sur
`mtc_pgbouncer:6432`.

## 5. DNS (OVH Manager → zone `mytradingcoach.app`)

Remplacer l'ancienne IP par la nouvelle sur tous les enregistrements A :

`mytradingcoach.app` (apex, redirigé vers www par Traefik) · `www` · `app` · `api` · `admin` ·
`dev` · `dev.app` · `dev.api` · `beta.app` · `beta.api` · `traefik`

⚠️ **Ne pas supprimer le jeton API OVH** utilisé par Traefik (`.env.traefik`, défi DNS Let's
Encrypt). Abaisser le TTL à l'avance si la migration est planifiée.

## 6. Traefik (HTTPS)

```sh
cd /opt/infra/traefik && docker compose up -d
docker logs -f mtc_traefik   # attendre l'obtention des certificats (défi DNS OVH)
```
Le volume `traefik_letsencrypt` repart vide : les certificats sont redemandés automatiquement.

## 7. Code et API

Le VPS clone le dépôt privé par SSH : ajouter la clé publique du VPS
(`ssh-keygen -t ed25519` puis `~/.ssh/id_ed25519.pub`) comme **deploy key en lecture** sur GitHub.

```sh
cd /opt/apps/mytradingcoach
git clone git@github.com:kyoshiroDev/my-trading-coach.git prod && git -C prod checkout main
git clone git@github.com:kyoshiroDev/my-trading-coach.git dev  && git -C dev checkout dev
git clone git@github.com:kyoshiroDev/my-trading-coach.git beta && git -C beta checkout beta
cp /tmp/restauration/apps/prod/.env.production prod/
cp /tmp/restauration/apps/dev/.env.dev         dev/
cp /tmp/restauration/apps/beta/.env.beta       beta/
chmod 600 */.env.*

cd prod
# API : blue/green (SCA-B8). Sur un hôte neuf, le script construit l'image, migre, démarre
# mtc_api_prod_blue + mtc_api_prod_worker et vérifie que Traefik (déjà lancé) les sert.
bash infra/deploy-api.sh prod
docker compose -f docker-compose.discord-bot.yml --env-file .env.production up -d --build
docker exec mtc_api_prod_blue wget -qO- http://localhost:3000/api/health/ready
```
⚠️ Toujours préciser `-f docker-compose.<env>.yml` : le `docker-compose.yml` par défaut n'est pas
celui du VPS. Dev et beta : même chose avec `docker-compose.dev.yml` / `.env.dev` et
`docker-compose.beta.yml` / `.env.beta`, **plus tard** (la prod d'abord). `.env.dev` porte
`REDIS_DB=1` et `REDIS_PREFIX=dev:` : ne pas les perdre, sinon dev partage le Redis de la prod.

## 8. Fronts statiques (app, admin, landing)

```sh
cd /opt/infra/static
docker compose up -d                            # mtc_app_prod, mtc_admin, mtc_landing_prod, mtc_*_dev
docker compose -f docker-compose.beta.yml up -d # mtc_app_beta_static
```
Les dossiers `/opt/static/*` sont vides : les remplir en relançant le CD.

**GitHub → Settings → Secrets and variables → Actions** : mettre à jour
- `VPS_HOST` : nouvelle IP ;
- `VPS_USER` : `greg` ;
- `VPS_SSH_KEY` : clé privée autorisée sur le nouveau VPS.

Puis relancer les workflows **CD — Deploy to Production** (main), **CI** (dev) et
**Beta — CI/CD** (beta). ⚠️ Le CD ne redéploie que les apps modifiées depuis le tag
`deployed/prod` : pour tout reconstruire, supprimer ce tag avant de relancer
(`git push origin :refs/tags/deployed/prod`).

## 9. Sauvegardes et tâches planifiées

```sh
cp /tmp/restauration/data/{backup-apps.sh,restore-test.sh} /opt/backups/
mkdir -p /opt/backups/mtc && cp /tmp/restauration/data/mtc/backup.sh /opt/backups/mtc/
chmod +x /opt/backups/*.sh /opt/backups/mtc/backup.sh
crontab /tmp/restauration/data/crontab.current && crontab -l
/opt/backups/mtc/backup.sh && /opt/backups/offsite.sh && /opt/backups/restore-test.sh
```
⚠️ Logs de cron dans `/opt/backups/*.log`, pas dans `/var/log` (non créable par `greg`).

## 10. Vérifications finales

- [ ] `docker ps` : 15 conteneurs `mtc_*`, tous `Up` / `healthy`.
- [ ] `https://api.mytradingcoach.app/api/health/ready` → Postgres et Redis `up`.
- [ ] `https://app.`, `https://www.`, `https://admin.` s'affichent ; `https://mytradingcoach.app` redirige vers `www`.
- [ ] Connexion avec un vrai compte, dashboard avec ses trades.
- [ ] Un webhook Stripe de test passe (Stripe → Developers → Webhooks → renvoyer un événement).
- [ ] Sentry reçoit les erreurs (release = SHA du commit).
- [ ] Le lendemain matin : `/opt/backups/offsite.log` montre une sauvegarde `OK`.
- [ ] Nettoyer `/tmp/restauration` (contient des secrets en clair).

## Points à assainir (hors reprise)

- Le mot de passe Redis est écrit en clair dans `/opt/infra/databases/docker-compose*.yml`
  (`--requirepass`) : à passer par `.env.databases`.
- `init-db.sh` ne crée pas la base beta.
- Répéter ce runbook sur un VPS de test et corriger chaque écart.
