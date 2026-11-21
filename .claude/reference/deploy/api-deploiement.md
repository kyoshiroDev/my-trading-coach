# API : mémoire, workers, CD ciblé, blue/green, keep-alive

> Contenu déplacé à l'identique depuis `.claude/agents/deploy.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : deploy.md · Mémoire et workers de l'API (SCA-B0-02, 2026-09-30) · 2026-09-30 -->
> **Origine** : `deploy.md` · « Mémoire et workers de l'API (SCA-B0-02, 2026-09-30) » · 2026-09-30

## Mémoire et workers de l'API (SCA-B0-02, 2026-09-30)

- `WEB_CONCURRENCY` : nombre de workers HTTP, défaut `min(cœurs, 3)`. Au démarrage, le primaire
  journalise le nombre retenu et le plafond de tas.
- Compose prod / dev / beta : `NODE_OPTIONS=--max-old-space-size=384`, `mem_limit: 2g`,
  `memswap_limit: 2g`, `stop_grace_period: 30s`.
- Le healthcheck Docker reste sur `/api/health` (liveness) **volontairement** : Traefik n'envoie
  aucun trafic à un conteneur `unhealthy`, et une coupure Redis passagère rendrait alors toute
  l'API injoignable alors qu'elle sait tourner en mode dégradé. `/api/health/ready` sert au
  garde-fou du CD et à la supervision externe.
- Les plafonds de 2 Gio sont des maxima, pas des réservations. Sur le VPS de 7,6 Go, dev et beta
  n'ont pas vocation à tourner à plein en même temps que la prod pendant un pic.

<!-- Origine : deploy.md · CD de l'API : déploiement ciblé, garde-fou et gel (SCA-B0-08, 2026-09-30) · 2026-09-30 -->
> **Origine** : `deploy.md` · « CD de l'API : déploiement ciblé, garde-fou et gel (SCA-B0-08, 2026-09-30) » · 2026-09-30

## CD de l'API : déploiement ciblé, garde-fou et gel (SCA-B0-08, 2026-09-30)

- `deploy-api` ne tourne que si `changes.outputs.api == 'true'` : projet Nx `api-mytradingcoach`
  affecté, **ou** fichier touché sous `prisma/`, `libs/shared/`, `scripts/discord-bot/`,
  `docker-compose.{prod,discord-bot}.yml`, `package.json`, `pnpm-lock.yaml`,
  `pnpm-workspace.yaml` (Nx ne rattache pas ces chemins à un projet). Un commit landing seul ne
  redémarre plus l'API. Les libs front (`libs/front/**`, que l'API n'importe pas) non plus : le
  motif valait `libs/` jusqu'au #1137.
- Après `up`, le job attend `/api/health/ready` (Postgres + Redis) jusqu'à **90 s**, sinon il
  échoue en affichant les 80 dernières lignes de logs, et `deployed/prod` ne bouge pas.
- **Gel** : variable de dépôt `FREEZE_API_DEPLOY=true` (Settings → Secrets and variables →
  Actions → Variables). L'API n'est plus déployée, les fronts si. Tant que le gel est actif et
  que l'API a changé, le tag `deployed/prod` ne bouge pas : au dégel, le CD suivant redéploie bien
  les changements gelés. Retirer la variable (ou la passer à `false`) pour dégeler.

<!-- Origine : deploy.md · Keep-alive Node ↔ Traefik (#301, 2026-10-03) · 2026-10-03 -->
> **Origine** : `deploy.md` · « Keep-alive Node ↔ Traefik (#301, 2026-10-03) » · 2026-10-03

## Keep-alive Node ↔ Traefik (#301, 2026-10-03)

Traefik 2.11 n'a **pas** de `serversTransport` configuré : il garde ses connexions inactives vers
l'API jusqu'à **90 s** (idleConnTimeout par défaut). Node les fermait après 5 s → 502 sporadiques
sous charge (225 sur 355 000 au test B9 n°4, sans erreur de l'API). `config/http-keepalive.ts` :
`keepAliveTimeout` 95 s, `headersTimeout` 96 s, appliqués après `app.listen` dans chaque worker.
**Si un jour on règle `serversTransport.forwardingTimeouts.idleConnTimeout` dans Traefik, garder le
délai de Node AU-DESSUS** (constante `TRAEFIK_IDLE_CONN_TIMEOUT_MS`). Vérification sur le VPS (⚠️ pas `wget` : il envoie `Connection: close`, Node ne renvoie alors
aucun en-tête `Keep-Alive`) :
`docker exec mtc_api_prod node -e "const h=require('http');h.get({host:'127.0.0.1',port:3000,path:'/api/health',agent:new h.Agent({keepAlive:true})},r=>{r.resume();console.log(r.headers['keep-alive'])})"`
→ `timeout=95`.

<!-- Origine : deploy.md · Déploiement API sans coupure — blue/green (SCA-B8, 2026-10-04) · 2026-10-04 -->
> **Origine** : `deploy.md` · « Déploiement API sans coupure — blue/green (SCA-B8, 2026-10-04) » · 2026-10-04

## Déploiement API sans coupure — blue/green (SCA-B8, 2026-10-04)

**En place sur dev et en prod** (2026-10-04, transition prod faite : voir plus bas). Script : `infra/deploy-api.sh <dev|prod> [<sha>]`, lancé par
la CI depuis le dépôt cloné sur le VPS. Compose : `api_blue` / `api_green` (`APP_ROLE=web`, mêmes
labels Traefik → même service) + `worker` (`APP_ROLE=worker`, crons et files, sans route Traefik).

Étapes : image `mtc_api_<env>:<sha>` (build sur le VPS, sautée si elle existe) → migration unique
(`run --rm … migrate`, conteneurs en `RUN_MIGRATIONS=false`) → couleur inactive démarrée → healthy
+ `/health/ready` → **vérification dans le journal d'accès Traefik que des sondes
`/api/health?deploy-probe=<sha>` arrivent sur son IP** → drain de l'ancienne (`/tmp/drain` → healthcheck
en échec → unhealthy → Traefik la retire → sondes vérifiées → 10 s → `docker stop -t 30`) → worker
recréé (quelques secondes sans cron) → `:latest` = version en service, 5 images SHA gardées.

- **Retour arrière** : `bash infra/deploy-api.sh <env> <sha>` (image gardée → pas de build, ~2 min).
- **Échec avant le drain** : la nouvelle couleur est drainée puis arrêtée, l'ancienne n'a jamais cessé
  de servir. Un seul déploiement à la fois (`flock /tmp/deploy-api-<env>.lock`).
- **Ne jamais faire diverger les labels Traefik entre couleurs** : un routeur défini différemment par
  deux conteneurs est rejeté par Traefik → coupure. D'où l'absence de middleware de retry.
- **Ne jamais arrêter une couleur sans drain** : Traefik continue de lui envoyer des requêtes pendant
  son arrêt propre → 502 (mesuré : 21 s).
- **Transition** depuis le conteneur unique d'avant B8 (`mtc_api_<env>`) : gérée par le script, mais
  ce conteneur ne sait pas se drainer → arrêté en 2 s, **~2 s d'erreurs une seule fois** → faire le
  premier déploiement prod à une heure creuse. **Faite sur dev et en prod** : ne se reproduit plus.
- Le journal d'accès Traefik n'écrit **pas** le user-agent (`"-"`) : marquer une sonde par l'URL.
- Sur dev (`NODE_ENV=development`) : pas de cluster, donc pas de crons (comme avant).

Répétition sur dev (2026-10-04, flux continu de requêtes) : blue → green **0 erreur / 201**, retour
arrière green → blue sans build **0 / 118**, remise au conteneur unique **0 / 102**. La répétition a
révélé deux défauts corrigés avant la PR : sondes non retrouvées (user-agent absent du journal) et
arrêt sans drain dans la branche d'abandon (21 s de 502).

### Prod : transition et retour arrière (SCA-B8-04)

**Transition prod faite le 2026-10-04** (SHA `315607ae`, merge #394) :
1. Le CD du merge a échoué sur le garde-fou (« transition vers le blue/green non demandée ») —
   comportement attendu ; Landing/App/Admin étaient déjà déployés, le dépôt du VPS déjà sur le SHA.
2. Workflow manuel, case transition cochée (run `37215943439`, 16:13 → 16:14 UTC) :
   `mtc_api_prod` → `mtc_api_prod_blue`, arrêt rapide de l'ancien conteneur (~2 s d'erreurs
   possibles à 16:14:04), worker healthy.
3. Relance du job échoué du CD (`gh run rerun <id> --failed`) pour rattraper ce que le workflow
   manuel ne fait pas (bot Discord, tag `deployed/prod`) : blue → green **sans coupure**, bot
   reconstruit, `deployed/prod` → `315607ae`.

Depuis : chaque merge sur `main` déploie l'API en blue/green, sans coupure ni action manuelle. Le
garde-fou ne se déclenche plus (plus de `mtc_api_prod`). **Piège** : après un passage par le workflow
manuel, le bot Discord et `deployed/prod` restent en retard jusqu'au prochain CD réussi.

- **CD** (`cd.yml`) : `bash infra/deploy-api.sh prod` après `git reset --hard <sha>`.
- **Garde-fou de transition** : en prod, tant que le conteneur unique `mtc_api_prod` tourne, le script
  **refuse** (avant tout build ou appel docker) sauf `DEPLOY_TRANSITION=1` → un merge sur `main` ne
  fait jamais la transition par surprise ; le job échoue, `deployed/prod` ne bouge pas.
- **Workflow « Deploy API prod (manuel) »** (`deploy-api-manual.yml`, `workflow_dispatch`) : SHA +
  case « transition ». Sert (1) à la transition, une fois, à une heure creuse, avec le SHA de `main`
  (l'image est construite si le dépôt du VPS est sur ce commit, ce qui est le cas après l'échec du CD) ;
  (2) au **retour arrière** vers une des 5 images gardées (sans build, ~2 min, sans coupure) ;
  (3) à une **relance sans coupure** (même SHA). Ne touche ni au dépôt du VPS ni à `deployed/prod`.
- Une image plus ancienne relancée applique `migrate deploy` avec moins de migrations que la base :
  vérifié, Prisma répond « No pending migrations » (code 0). D'où la règle N-1 (`prisma.md`).
- **Supervision** (`watch-containers.sh`, `etat-prod.sh`) : API prod vérifiée comme « au moins une
  couleur web (`mtc_api_prod_blue|_green`) + `mtc_api_prod_worker` » ; l'ancien `mtc_api_prod` compte
  pour les deux ; une couleur en drain (`/tmp/drain`) n'est pas une alerte. Compatibles avant et après
  la transition : **les copier dans `/opt/backups/` avant la transition**.
- Conteneurs prod (depuis la transition) : `mtc_api_prod_blue` **ou** `_green` (web) + `mtc_api_prod_worker`.
  `docker logs` / `docker stats` : viser la couleur en marche (`docker ps | grep mtc_api_prod`).
