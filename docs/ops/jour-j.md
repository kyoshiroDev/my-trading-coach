# Procédure jour J — mise en ligne NinjaTrader Marketplace

> SCA-B7-06, rédigée le 2026-10-01. Objectif : passer le pic d'inscriptions sans incident, et
> savoir quoi faire si un incident arrive. Un seul VPS (4 cœurs, 7,6 Go) porte tout : on lui
> retire tout ce qui ne sert pas la prod pendant la fenêtre de lancement.
>
> Règle de la fenêtre : **aucun changement non indispensable sur la prod.** Pas de migration, pas
> de redémarrage de Postgres, pas d'essai en direct. Un correctif urgent suit la section 4.

## 1. La veille (J-1)

| ✓ | Contrôle | Comment |
|---|---|---|
| ☐ | État de la prod au vert | sur le VPS : `/opt/backups/etat-prod.sh` (aucune ligne ⚠️ hors « dev/beta en marche ») |
| ☐ | Sauvegarde hors-site de la nuit OK | `tail -5 /opt/backups/offsite.log` → « sauvegarde OK » daté du jour |
| ☐ | IA active en prod | `grep -c '^AI_ENABLED=true' /opt/apps/mytradingcoach/prod/.env.production` → `1` |
| ☐ | **Quota d'e-mails Resend** | plan gratuit = **100/jour, 3 000/mois** ; au-delà, bienvenue **et mot de passe oublié** ne partent plus. Règle : **passer au plan Pro (20 $/mois, 50 000/mois, sans limite/jour) dès qu'on dépasse 80 envois/jour** → alerte Sentry « Resend : 80 e-mails envoyés aujourd'hui ». Un quota dépassé remonte aussi dans Sentry (`Resend : daily_quota_exceeded`, fatal) |
| ☐ | Palier Anthropic suffisant | console Anthropic → Limits (question A-06 ouverte) |
| ☐ | Webhook Stripe live actif | Stripe → Developers → Webhooks → endpoint `api.mytradingcoach.app` sans échec récent |
| ☐ | Supervision | UptimeRobot : 4 sondes « Up », appli mobile avec notifications push ; e-mails d'alerte reçus sur `hello@` (pas en spam) |
| ☐ | Sentry | une règle d'alerte « nouvelle issue » vers ton e-mail (Sentry → Alerts) |
| ☐ | Rien d'urgent en attente sur `main` | ce qui doit être en prod pour le lancement est déployé **avant** le gel |

## 2. Le matin du jour J

**a. Geler les déploiements de l'API** (les fronts restent déployables) :
GitHub → Settings → Secrets and variables → Actions → **Variables** → `FREEZE_API_DEPLOY` = `true`
(ou `gh variable set FREEZE_API_DEPLOY --body true`).
Un merge sur `main` qui touche l'API ne la redéploie plus ; le tag `deployed/prod` ne bouge pas,
donc ces changements partiront au dégel.

**b. Arrêter les API dev et beta** (≈ 600 Mo de RAM et du CPU rendus à la prod) :
```sh
docker stop $(docker ps -q --filter 'name=^mtc_api_(dev|beta)')   # couleurs + worker (blue/green, SCA-B8)
```
⚠️ Un push sur `dev` ou `beta` les **relance** (CI / Beta CI/CD redéploient). Pendant la
fenêtre : pas de push sur ces branches, ou les arrêter à nouveau après. Le script de surveillance
n'alerte pas pour dev/beta arrêtés (volontaire).

**c. Vérifier** : `/opt/backups/etat-prod.sh` → tout « OK », y compris « API dev/beta en marche : aucune ».

## 3. Pendant le pic

Sur le VPS, en continu dans un terminal :
```sh
watch -n 30 /opt/backups/etat-prod.sh
```
À côté : **Sentry** (nouvelles erreurs), **UptimeRobot**, la boîte `hello@` (alertes conteneurs).

| Symptôme (ligne ⚠️ du script) | Cause probable | Que faire |
|---|---|---|
| `/health/ready` ≠ 200 | Postgres ou Redis injoignable | `docker ps -a`, `docker logs --tail 50 mtc_postgres` / `mtc_redis` / `mtc_pgbouncer`. Ne pas redémarrer Postgres à l'aveugle : regarder d'abord |
| Erreurs 5xx ≥ 10 en 10 min | bug sous charge | les routes en tête sont affichées : ouvrir l'issue dans Sentry. Correctif → section 4 |
| Beaucoup de 429 | limites anti-abus atteintes | normal si un seul réseau (bureau, école) inscrit beaucoup de monde ; anormal si tout le monde : regarder les routes dans les logs |
| PgBouncer : requêtes **en attente** | les 15 connexions prod sont toutes prises (requêtes lentes) | regarder la ligne « requêtes > 500 ms » et `pg_stat_statements` (`deploy.md`). Dernier recours : `DB_POOL_MAX=6` dans `.env.production` + recréation de l'API (≈ 20 s de coupure ; 3 × 6 = 18, tient dans le pool de 20). Plus de connexions ne sert à rien si ce sont les requêtes qui sont lentes |
| Mémoire `mtc_api_prod` ≥ 80 % | fuite ou pic de PDF / imports | `docker stats` ; si elle monte sans redescendre : relance **sans coupure** = bascule sur la même version (image gardée, pas de build, ~2 min) : `cd /opt/apps/mytradingcoach/prod && bash infra/deploy-api.sh prod "$(git rev-parse --short=12 HEAD)"` (ou workflow « Deploy API prod (manuel) » avec ce SHA). Jamais `docker restart` d'une couleur (≈ 15 s de coupure) |
| Mémoire Redis ≥ 75 % | files BullMQ qui gonflent | `docker exec mtc_redis redis-cli -a … --no-auth-warning info keyspace` ; à 100 %, Redis refuse les écritures (noeviction) |
| Disque ≥ 85 % | logs Docker, dumps | `docker system df` ; `docker image prune -f` (sans risque pour les conteneurs en marche) |
| Le VPS ne répond plus du tout | — | console OVH (KVM) ; si perdu : `docs/ops/reprise-vps.md` |

## 4. Correctif urgent pendant le gel

1. Correctif sur une branche, PR, merge sur `main` comme d'habitude (CI verte obligatoire).
2. Supprimer (ou passer à `false`) la variable `FREEZE_API_DEPLOY`.
3. GitHub → Actions → dernier run **CD — Deploy to Production** → **Re-run all jobs**.
   Le job attend jusqu'à 90 s que `/api/health/ready` réponde 200, sinon il échoue.
4. Vérifier `etat-prod.sh` et Sentry, puis **remettre** `FREEZE_API_DEPLOY=true`.

Un déploiement de l'API = **≈ 15-20 s de coupure** (pas encore de blue/green : phase B8).

## 5. Après (J+2 ou J+3, quand le trafic est stabilisé)

- Retirer `FREEZE_API_DEPLOY` (les changements API en attente partiront au prochain CD).
- Relancer dev et beta :
  ```sh
  cd /opt/apps/mytradingcoach/dev  && docker compose -f docker-compose.dev.yml  --env-file .env.dev  up -d --no-build
  cd /opt/apps/mytradingcoach/beta && docker compose -f docker-compose.beta.yml --env-file .env.beta up -d --no-build
  ```
- Relever les chiffres du pic (inscriptions, pic mémoire, top requêtes `pg_stat_statements`)
  pour dimensionner la suite (phases B1-B6, partie C).
