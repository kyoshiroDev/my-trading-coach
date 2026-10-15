# Bascule de la prod vers le VPS prod (149.202.40.240)

> Rédigée le 2026-10-15. Objectif : faire passer API, worker, bot Discord, app Angular, Postgres
> et Redis de la prod de l'ancien VPS (`51.83.197.230`, qui garde dev et beta) vers le VPS dédié
> `mtc-prod`, avec **une dizaine de minutes d'indisponibilité de l'API**, la nuit.
> Landing et admin ne sont pas concernés (ils restent sur l'ancien VPS jusqu'à Vercel).
>
> Référence du VPS prod : `infra/prod/README.md`. Scripts : `infra/prod/bascule/` (copiés sur le
> VPS prod dans `/opt/infra/bascule/`).

## 0. Ce qui est déjà prêt (2026-10-15)

- VPS prod durci, Traefik v3, Postgres / PgBouncer / Redis, sauvegardes locales + B2 (dépôt `prod`).
- Dépôt cloné dans `/opt/apps/mytradingcoach/prod`, `.env.production` construit (base, Redis et
  hôte SSH de l'admin pointent sur le VPS prod), image API construite et testée sur base vide.
- App Angular servie par `mtc_app_prod` (releases copiées depuis l'ancien VPS).
- Certificats `api.` et `app.` déjà émis (challenge DNS OVH) : rien à attendre au moment du DNS.
- Traefik du VPS prod accepte le PROXY protocol de l'ancien VPS (relais de bascule).
- **Répétition faite** : dump → restauration en 5 s, comptes identiques ; copie Redis OK.
- Secrets GitHub `PROD_VPS_HOST` / `PROD_VPS_SSH_KEY` (env `production`) créés. La modification
  de `cd.yml` / `deploy-api-manual.yml` qui les utilise est prête mais **pas encore sur `main`**.

## 1. La veille (J-1)

| ✓ | Action | Comment |
|---|---|---|
| ☐ | Baisser le TTL DNS de `api` et `app` à **300 s** | OVH → Zone DNS `mytradingcoach.app` → modifier les deux enregistrements A (TTL actuel ≈ 1 h) |
| ☐ | Rien d'urgent en attente sur `main` | ce qui doit partir est déployé avant le gel |
| ☐ | Sauvegarde de la nuit OK sur l'ancien VPS | `tail -3 /opt/backups/offsite.log` |
| ☐ | VPS prod au vert | `docker ps` : traefik, socket-proxy, postgres, pgbouncer, redis, app-prod |

## 2. La nuit J (≈ 15 min, ex. 1 h 00 — avant les sauvegardes de 3 h)

Notation : **[A]** = sur l'ancien VPS, **[P]** = sur le VPS prod, **[GH]** = GitHub, **[L]** = poste.

**a. Geler** **[GH]** : `gh variable set FREEZE_API_DEPLOY --body true` — et ne rien merger sur `main`.

**b. Mettre le VPS prod sur la version en service** **[P]** :
```sh
cd /opt/apps/mytradingcoach/prod && git fetch -q --tags origin && git checkout -q deployed/prod && git log --oneline -1
```
Puis resynchroniser l'app (dernière release publiée) **[L]** :
```sh
ssh greg@51.83.197.230 'tar -C /opt/static -cf - app-prod' | ssh greg@149.202.40.240 'rm -rf /opt/static/app-prod && tar -C /opt/static -xf -'
```

**c. Arrêter la prod sur l'ancien VPS** **[A]** — début de l'indisponibilité de l'API :
```sh
docker stop mtc_api_prod_blue mtc_api_prod_green mtc_api_prod_worker mtc_discord_bot mtc_app_prod 2>/dev/null; docker ps --format '{{.Names}}' | grep -E 'prod|discord'
```
(Plus aucun job ne tourne : les files BullMQ restent dans Redis et seront copiées.)

**d. Relais** **[L]** : copier le relais dans l'ancien Traefik (pris en compte en quelques secondes) :
```sh
scp infra/prod/bascule/relais-ancien-vps.yml greg@51.83.197.230:/opt/infra/traefik/conf.d/
```
À partir d'ici, `api.` et `app.` arrivent au VPS prod même avec l'ancien DNS (l'API y est encore
arrêtée : 404/502 attendus jusqu'à l'étape f).

**e. Copier les données** **[L]** :
```sh
ssh greg@51.83.197.230 "docker exec mtc_postgres pg_dump -U mtc_readonly -Fc mytradingcoach_prod" \
  | ssh greg@149.202.40.240 "bash /opt/infra/bascule/import-postgres.sh mytradingcoach_prod"
ssh greg@51.83.197.230 'bash -s' < infra/prod/bascule/export-redis-ancien.sh \
  | ssh greg@149.202.40.240 "bash /opt/infra/bascule/import-redis.sh"
```
Comparer `users=… trades=…` avec l'ancienne base :
`ssh greg@51.83.197.230 "docker exec mtc_postgres psql -U mtc_readonly -d mytradingcoach_prod -Atc 'SELECT count(*) FROM \"User\"'"`

**f. Démarrer l'API, le worker et le bot** **[P]** :
```sh
cd /opt/apps/mytradingcoach/prod
bash infra/deploy-api.sh prod    # premier passage : pas d'ancienne couleur → blue + worker
docker compose -f docker-compose.discord-bot.yml --env-file .env.production up -d --build discord-bot
```
Fin de l'indisponibilité dès que `deploy-api.sh` affiche « ✅ … reçoit du trafic ».

**g. DNS** (OVH) : A `api` et A `app` → `149.202.40.240`.

**h. Vérifier** :

| ✓ | Contrôle | Comment |
|---|---|---|
| ☐ | API prête | `curl https://api.mytradingcoach.app/api/health/ready` (par le relais puis par le DNS) |
| ☐ | Vraie IP client vue par l'API | `docker logs mtc_traefik --tail 20` [P] : IP clientes ≠ 51.83.197.230 |
| ☐ | Connexion + un trade affiché | dans l'app, compte réel |
| ☐ | Webhook Stripe | Stripe (live) → Webhooks → endpoint prod → renvoyer un événement récent → 200 |
| ☐ | Worker | `docker logs mtc_api_prod_worker --tail 50` : crons armés, files consommées |
| ☐ | Bot Discord en ligne | statut du bot sur le serveur Discord |
| ☐ | Admin : pages VPS / sauvegardes | lisent maintenant le VPS prod (`VPS_HOST`) |
| ☐ | Sentry sans nouvelle erreur | |

**i. CD vers le VPS prod** : pousser la modification de `cd.yml` / `deploy-api-manual.yml`
(secrets `PROD_VPS_*`) jusqu'à `main`, puis dégeler : `gh variable set FREEZE_API_DEPLOY --body false`.

**j. Sauvegardes** **[P]** : `/opt/backups/mtc/backup.sh && /opt/backups/offsite.sh && /opt/backups/restore-test.sh`

## 3. Retour arrière

Possible tant que les utilisateurs n'ont pas écrit de données importantes sur le VPS prod
(au-delà, recopier dans l'autre sens avec les mêmes scripts) :
1. **[A]** `rm /opt/infra/traefik/conf.d/relais-ancien-vps.yml`
2. **[A]** `docker start mtc_api_prod_blue mtc_api_prod_worker mtc_discord_bot mtc_app_prod`
   (la couleur active était `blue` ou `green` : démarrer celle qui tournait)
3. **[P]** `docker stop mtc_api_prod_blue mtc_api_prod_worker mtc_discord_bot` (le bot ne doit tourner qu'à un endroit)
4. DNS : remettre `51.83.197.230` si déjà changé.

## 4. Après la bascule (J+2 et plus)

- [ ] Plus aucune requête par le relais (`docker logs mtc_traefik` sur [A]) → supprimer
      `relais-ancien-vps.yml` [A] et `proxyProtocol` du `traefik.yml` [P] (+ copie du dépôt).
- [ ] **[A]** supprimer l'ancienne prod : conteneurs, `/opt/apps/mytradingcoach/prod`,
      `/opt/static/app-prod`, base `mytradingcoach_prod` (après un dernier dump gardé hors-site),
      pool prod de PgBouncer, ligne prod de `backup.sh` (devient optionnelle → la retirer).
- [ ] **[A]** changer le mot de passe Redis de l'ancien VPS (exposé le 2026-10-15) et les `.env` dev/beta.
- [ ] **[P]** installer la surveillance (`infra/monitoring/*.sh`) et son cron.
- [ ] **[P]** retirer le sudo sans mot de passe : `sudo rm /etc/sudoers.d/90-greg-setup`.
- [ ] Mettre à jour `.claude/agents/deploy.md` (infrastructure, compose, sauvegardes) et `CLAUDE.md` (URLs).
