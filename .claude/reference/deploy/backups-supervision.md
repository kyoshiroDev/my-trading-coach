# Sauvegardes, hors-site et supervision

> Contenu déplacé à l'identique depuis `.claude/agents/deploy.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : deploy.md · Backups & Monitoring · 2026-04-25 -->
> **Origine** : `deploy.md` · « Backups & Monitoring » · 2026-04-25

## Backups & Monitoring

```bash
# Backups automatiques (crons VPS, user greg)
# 03h00 chaque nuit  → pg_dump prod + dev + beta → /opt/backups/mtc/   (rétention 14 j)
# 03h30 chaque nuit  → docker system prune + builder prune
# 04h00 dimanche     → docker buildx prune --keep-storage=8GB
# 22h45 dimanche     → images Docker + configs   → /opt/backups/apps/  (rétention 30 j)
# Pas de notification Discord (webhooks morts, retirés) — le contrôle de
# fraîcheur se fait dans l'app admin, qui lit /opt/backups/mtc.
#
# ⚠️ Les logs de ces crons vont dans /opt/backups/*.log et JAMAIS dans /var/log/ :
# greg ne peut pas y créer de fichier, et une redirection qui échoue à
# l'ouverture empêche le job de s'exécuter sans laisser la moindre trace.

```

### Format et périmètre des dumps BDD

```
Répertoire : /opt/backups/mtc/          (surveillé par l'app admin via BACKUP_DIR)
Script     : /opt/backups/mtc/backup.sh
Format     : mtc_<prod|dev|beta>_YYYYMMDDTHHMM_<auto|manual>.sql.gz
Commande   : docker exec mtc_postgres pg_dump -U mtc_user mytradingcoach_<env> | gzip > ...
```

Les **3 environnements** sont dumpés : `prod` (requis — le script sort en erreur
si son dump échoue), `dev` et `beta` (optionnels). Un dump vide ou tronqué est
**supprimé** plutôt que conservé, pour ne pas donner une fausse impression de
sécurité.

`BackupService` déduit l'environnement du **nom de fichier** (`_dev_` / `_beta_`,
sinon `prod`) → ajouter une base au backup impose de toucher **3 endroits**, sinon
le dump s'affiche sous le mauvais environnement dans l'admin :
`backup.sh` (VPS) · `backup.service.ts` (`DB_BY_TARGET`, `LABEL_BY_TARGET`,
`targetFromFilename`) · `TARGET_CONFIG` du front admin.

### ⚠️ Jamais de dump de prod restauré tel quel en beta ou dev

La beta tourne avec un process de crons (campagnes, J+3, J+11, J+15, onboarding) et la clé
Resend réelle. **Aucun filtre d'adresses** côté code (#862 non retenu le 2026-11-04) : seule la
séparation des bases protège les vrais utilisateurs. Une copie de la base de prod restaurée en
beta (ou en dev) ferait écrire la beta à toute la base réelle.

Règle : avant tout démarrage d'une API sur une base issue d'un dump de prod, **remplacer
toutes les adresses e-mail** par des adresses de test Resend, dans la même session psql que la
restauration :

```sql
UPDATE "User"           SET email = 'delivered+u-' || id || '@resend.dev';
UPDATE "DeletedAccount" SET email = 'delivered+d-' || id || '@resend.dev' WHERE email IS NOT NULL;
```

- Nouvelle colonne e-mail dans le schéma → l'ajouter ici.
- Ne jamais restaurer un dump de prod sur la base d'un environnement dont l'API tourne :
  arrêter d'abord l'API et son process de crons.
- Si un jour la beta est ouverte à d'autres personnes, ou si une copie de prod y devient
  nécessaire, rouvrir #862 (liste blanche d'envoi).

### Monitoring — ⚠️ inexistant

`/opt/apps/monitor-containers.sh` a disparu du VPS et n'est plus dans le cron
(vérifié le 10 août 2026). Les webhooks Discord sont morts par ailleurs. Il n'y a
donc **aucune alerte automatique** : ni sur un conteneur qui tombe, ni sur un
backup qui échoue. Le seul contrôle est l'app admin, qui suppose une consultation
manuelle.

<!-- Origine : deploy.md · Supervision (SCA-B7-08, 2026-10-01) · 2026-10-01 -->
> **Origine** : `deploy.md` · « Supervision (SCA-B7-08, 2026-10-01) » · 2026-10-01

## Supervision (SCA-B7-08, 2026-10-01)

**Interne — `infra/monitoring/watch-containers.sh`** (installé dans `/opt/backups/`, cron
`*/5 * * * *`, log `/opt/backups/watch-containers.log`) :
- conteneurs **critiques** (`mtc_api_prod`, `mtc_postgres`, `mtc_pgbouncer`, `mtc_redis`,
  `mtc_traefik`, `mtc_app_prod`, `mtc_landing_prod`, `mtc_admin`, `mtc_discord_bot`) : alerte s'ils
  sont arrêtés ;
- tous les `mtc_*` qui tournent : alerte si `unhealthy`, tués par OOM, ou **nouveau** redémarrage
  automatique depuis le passage précédent (`RestartCount` est cumulé : on compare au passage d'avant,
  mémorisé dans `/opt/backups/.watch-restarts`) ;
- dev et beta **arrêtés volontairement** (jour J) : pas d'alerte ;
- disque `/` ≥ 85 % ;
- **VPS prod seulement** (`infra/prod/monitoring/`) : reboot nécessaire (`/var/run/reboot-required`),
  puisque la prod ne redémarre jamais seule (voir « Maintenance des VPS »).

Deux copies depuis la migration du 2026-10-15 : `infra/prod/monitoring/watch-containers.sh` (VPS prod,
API blue/green, app, bot) et `infra/monitoring/watch-containers.sh` (ancien VPS : landing, admin,
dev, beta ; clé Resend lue dans `.env.beta`, l'ancien `.env.production` ayant été supprimé).

E-mail via l'API Resend (clé lue dans `.env.production` sur la prod) vers `hello@mytradingcoach.app`,
**seulement au changement d'état** (panne → 🔴, rétablissement → 🟢). L'état
(`/opt/backups/.watch-state`) n'est mémorisé qu'après un envoi réussi.
⚠️ Resend est derrière Cloudflare : sans `User-Agent` explicite, Python-urllib reçoit **403**.
Tests : `WATCH_DRY=1` (affiche l'état, n'envoie rien) · `WATCH_TEST=1` (envoie un e-mail de test).

**Interne — `infra/monitoring/watch-apihosts.sh`** (#420, installé dans `/opt/backups/`, cron
`7,22,37,52 * * * *`, log `/opt/backups/watch-apihosts.log`) : e-mail 🔀 quand l'ensemble des hôtes
Tradovate DISTINCTS stockés en base prod (`BrokerConnection.apiHosts` : `live`, `demo`,
`reportingLive`, `reportingDemo`, connexions `CONNECTED`) change, c.-à-d. quand NinjaTrader bascule
une prop firm sur une autre infra (cf. #286, `tradovate-hosts.ts` : l'API suit seule, l'alerte sert
à le savoir). Une nouvelle connexion sur un hôte déjà connu ne déclenche rien. État de référence
dans `/opt/backups/.watch-apihosts-state` (1er passage = mémorisation sans e-mail ; mémorisé
seulement après un envoi réussi). Même chaîne Resend que ci-dessus. Tests : `WATCH_DRY=1` ·
`WATCH_TEST=1` · `WATCH_APIHOSTS_STATE=<fichier temporaire>` pour simuler un changement.

**Externe — UptimeRobot** (plan gratuit, compte `hello@mytradingcoach.app`) : sondes HTTP toutes
les 5 min depuis l'extérieur, alerte e-mail vers `hello@mytradingcoach.app`. Elles détectent la perte
totale du VPS, que le script interne ne peut pas signaler.
| Sonde | URL |
|---|---|
| API prod - ready (Postgres + Redis) | `https://api.mytradingcoach.app/api/health/ready` (503 si Postgres ou Redis tombe) |
| app.mytradingcoach.app | `https://app.mytradingcoach.app` |
| Landing prod | `https://www.mytradingcoach.app/` |
| admin.mytradingcoach.app | `https://admin.mytradingcoach.app` |
Pas de sonde sur dev/beta (arrêtables volontairement). Nouvelle app publique → ajouter sa sonde.

<!-- Origine : deploy.md · Sauvegarde hors-site (SCA-B7-09, 2026-09-30) · 2026-09-30 -->
> **Origine** : `deploy.md` · « Sauvegarde hors-site (SCA-B7-09, 2026-09-30) » · 2026-09-30

## Sauvegarde hors-site (SCA-B7-09, 2026-09-30)

Avant : dumps quotidiens **uniquement sur le VPS** (`/opt/backups/mtc`), perdus avec lui.

| Élément | Valeur |
|---|---|
| Destination | Backblaze B2, bucket `mtc-backups-7k3q9x`, région **EU Central** (Amsterdam), privé, SSE-B2, « keep only the last version » |
| Compte B2 | `hello@mytradingcoach.app` (2FA). Clé d'application **`mtc-vps-restic`**, limitée au bucket, Read and Write. **Jamais la clé maîtresse sur le VPS.** |
| Outil | restic 0.18.1 **dans un conteneur** (`restic/restic`), dépôt `b2:mtc-backups-7k3q9x:mtc`, chiffré avant envoi |
| Scripts | `infra/backups/backup.sh` (dumps dev et beta, en 600) dans `/opt/backups/mtc/` ; `offsite.sh` et `restore-test.sh` dans `/opt/backups/` |
| Identifiants | `/opt/backups/offsite.env` (chmod 600, jamais versionné, modèle `offsite.env.example`) |
| Contenu | dumps des 3 bases (`/opt/backups/mtc`) **et tout ce qui n'existe que sur le VPS**, chaque nuit : `/opt/infra/databases` (compose, `.env.databases`, `pgbouncer.ini`, `init-db.sh`), `/opt/infra/static` (compose, confs nginx), Traefik (`traefik.yml`, compose, `.env.traefik` avec le jeton API OVH des certificats), les `.env` de prod/dev/beta, la crontab, les scripts de sauvegarde. **Pas** : le code (GitHub), les builds et images (refaits par le CI), les certificats (Let's Encrypt les régénère), `offsite.env` (gestionnaire de mots de passe). Aucun fichier utilisateur sur disque : toutes les données sont dans Postgres. |
| Planning | cron `45 3 * * *` (après `backup.sh` à 3 h et le nettoyage Docker à 3 h 30), log `/opt/backups/offsite.log` |
| Rétention | 14 quotidiennes, 8 hebdomadaires, 6 mensuelles ; `check --read-data-subset=5%` le dimanche |

⚠️ **`RESTIC_PASSWORD` est dans le gestionnaire de mots de passe de Greg.** Sans lui, les sauvegardes
sont illisibles. Les clés B2 aussi (l'`applicationKey` n'est affichée qu'une fois par Backblaze).

**Test de restauration** : `/opt/backups/restore-test.sh`. Il restaure le dernier instantané, charge
le dernier dump prod dans un **Postgres jetable** (jamais `mtc_postgres`), compare users et trades
avec la prod, puis nettoie (`docker rm -f -v` : sans `-v`, chaque test laissait un volume
Postgres anonyme de ~110 Mo, corrigé le 2026-10-16). Premier test le 2026-09-30 : dump de 3 h → 20 users · 882 trades,
0 erreur de chargement (prod : 911 trades, écart = activité de la journée). À relancer après tout
changement de la sauvegarde et au moins une fois par trimestre.

**Limites B2 (Caps & Alerts, gratuit, sans moyen de paiement)** : stockage 10 Go, téléchargement
1 Go/jour, 2 500 transactions B et C/jour. Alertes e-mail à `hello@mytradingcoach.app` à 75 % et
100 %. ⚠️ Plafonds stricts à 0 $ : à 10 Go les envois échouent (la sauvegarde de la nuit aussi) ;
une restauration ne télécharge qu'1 Go/jour. Estimation : ~250 Mo aujourd'hui, ~14 Go vers 10 000
actifs. À l'alerte de 7,5 Go, ou avant une restauration d'urgence volumineuse : ajouter un moyen de
paiement et relever la limite (quelques centimes).

**Remonter tout le VPS** (machine perdue ou changée) : runbook pas à pas `docs/ops/reprise-vps.md`
(serveur, B2, bases, DNS, Traefik, API, fronts, secrets GitHub, cron, vérifications).

**Restaurer pour de vrai** (VPS perdu) : sur la nouvelle machine, recréer `offsite.env` depuis le
gestionnaire de mots de passe, puis `offsite.sh snapshots` et
`offsite.sh restore latest /tmp/restauration` : les dumps sont dans `/tmp/restauration/data/mtc/`,
les configs dans `/tmp/restauration/infra/` (à recopier dans `/opt/infra/`), les `.env` dans
`/tmp/restauration/apps/<env>/`, la crontab dans `/tmp/restauration/data/crontab.current`.
Options restic en plus après le dossier (VPS prod) : `offsite.sh restore latest /tmp/r --include /data/mtc`
ne restaure que les dumps. `restore-test.sh` fait ainsi depuis le 2026-10-16 : restaurer tout l'instantané
recréait `infra/databases/pgbouncer-auth` en uid 70 / 700, que greg ne pouvait plus supprimer.
