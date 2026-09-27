# PROMPT — Corriger l'ensemble des constats de l'audit du 27/09/2026

> **Pour l'agent qui exécute ce prompt.** Lis ce document en entier avant de toucher au code.
> Il est découpé en **10 phases** livrables une par une. Chaque tâche indique **quoi faire**,
> **où**, et **comment savoir que c'est terminé**. Ne saute pas d'étape, ne fusionne pas les phases.

---

## 0. Rôle et objectif

Tu es un développeur senior full-stack (Angular 22, NestJS 11, Astro 7, Nx 23, Prisma 7).
Ta mission : corriger **tous** les constats de l'audit `docs/audit-ui-ux-dx-2026-09-27.md` (et de
`docs/audit-ux-ui-landing-2026-09-27.md` pour les points code de la landing) sur l'app, l'admin,
l'API, la landing et le monorepo Nx.

Objectif final : un code **sans duplication entre projets**, **lisible par un développeur junior**,
**accessible (WCAG 2.2 AA)**, **robuste en prod**, avec une CI et un CD fiables.

---

## 1. Sources à lire AVANT de coder

| Fichier | Pourquoi |
|---|---|
| `CLAUDE.md` | Règles globales du projet (pnpm, commits, compte démo, plans) |
| `docs/audit-ui-ux-dx-2026-09-27.md` | **Le cahier des charges** : chaque tâche ci-dessous y renvoie (§ x.y) |
| `docs/audit-ux-ui-landing-2026-09-27.md` | Audit UX de la landing (points code seulement) |
| `.claude/agents/<domaine>.md` | Règles du domaine touché : `angular.md`, `nestjs.md`, `astro.md`, `prisma.md`, `plans.md`, `design.md`, `security.md`, `tests.md`, `deploy.md` |
| `admin-mytradingcoach.html` | Maquette de référence **avant toute modification de l'admin** |

---

## 2. Règles non négociables

1. **pnpm uniquement** : `pnpm`, `pnpm exec`, `pnpm dlx`. Jamais `npm` ni `npx`, y compris dans les hooks et la CI.
2. **Builder et tester après chaque tâche** : zéro erreur avant de passer à la suivante (commandes en § 5).
3. **Commits atomiques** au format conventionnel : `feat(scope):`, `fix(scope):`, `perf(scope):`, `refactor(scope):`, `docs(scope):`, `chore(scope):`, `ci(scope):`. **Un commit par tâche**, en indiquant son ID (ex. `fix(api): trust proxy derrière traefik [API-01]`).
4. **Aucun changement de comportement hors périmètre.** Un refactor ne change pas ce que voit l'utilisateur, sauf si la tâche le demande.
5. **Ne jamais désactiver, sauter ou supprimer un test** pour obtenir du vert. Un test cassé par un refactor se corrige ou se réécrit à comportement égal.
6. **Compte démo** : toute nouvelle mutation est déjà bloquée par `DemoReadOnlyGuard`, rien à faire. Toute nouvelle agrégation admin, cron ou email ciblant des users doit exclure `isDemo: true`.
7. **Prix et plans** : ne modifier **aucune valeur** de prix. Toute tâche qui touche prix, features gated ou accès par plan suit `.claude/agents/plans.md`, avec cohérence obligatoire aux 4 points : landing, front, guard, cron.
8. **Mettre à jour l'agent concerné** dans `.claude/agents/` dès qu'une règle ou un comportement change (tableau de correspondance dans CLAUDE.md). Un agent périmé est pire que pas d'agent.
9. **Pas de nouvelle référence `PROMPT-xxx`** dans le code. Un commentaire explique le **pourquoi** en une phrase ; pour une trace, lien vers une PR ou une issue GitHub.
10. **Code en anglais, interface en français (tutoiement).** Noms de fichiers, dossiers, variables et classes en anglais ; textes affichés en français.
11. **Styles** : CSS dans les `.css` (jamais inline dans les `.ts`), `@if`/`@for`, `OnPush`, signaux. Voir `angular.md`.
12. **Pas de `console.log` côté NestJS** : utiliser `Logger`.
13. **Admin** : reproduire le design de `admin-mytradingcoach.html`, ne rien inventer.

---

## 3. Décisions à faire valider AVANT de commencer

Pose ces questions à l'utilisateur au démarrage. Sans réponse, applique le **choix par défaut** et signale-le dans le rapport final.

| ID | Question | Choix par défaut |
|---|---|---|
| D1 | Libellés de navigation : quelle langue ? | Tout en français : « Tableau de bord », « Session du jour », « Historique des sessions », « Journal », « Mes comptes », « Statistiques », « Insights IA », « Débrief hebdo », « Calendrier éco », « Score trader ». Sections : « VUE D'ENSEMBLE », « ANALYSE & IA », « COMPTE ». |
| D2 | Landing : composants non rendus (`CoachIA`, `Debrief`, `Showcase`, `mockup/*`, 2 270 lignes) | **Les brancher** sur la home (ils apportent les visuels produit qui manquent). Sinon, les supprimer. |
| D3 | Note `aggregateRating` (4,8/5, 24 avis) dans le JSON-LD | **Supprimer** tant qu'aucun vrai système d'avis n'existe. |
| D4 | Images Docker construites en CI et poussées sur GHCR (au lieu de `docker compose build` sur le VPS) | Oui, en phase 9, sans casser le déploiement actuel (bascule en fin de phase). |
| D5 | Validation API : migrer class-validator vers zod partagé ? | **Progressif** : zod partagé pour le module `trades` d'abord, les autres modules restent en class-validator. |
| D6 | Tests E2E en CI | Smoke Playwright de 3 scénarios, **non bloquant** au départ. |
| D7 | Fontes : auto-hébergement (`@fontsource/*`) | Oui, app et landing. |

---

## 4. Méthode de travail

1. **Une phase = une branche = une PR.** Nom de branche : `fix/audit-phase-<n>-<slug>`, à partir de la branche de dev habituelle.
2. Dans une phase, traite les tâches **dans l'ordre** : les premières débloquent les suivantes.
3. Pour chaque tâche :
   1. relire le § de l'audit cité ;
   2. lire le code actuel ;
   3. corriger ;
   4. ajouter ou adapter les tests ;
   5. lancer les commandes de vérification ;
   6. committer.
4. **Si une tâche est plus grosse que prévu** (plus de 15 fichiers, ou changement d'API publique non prévu) : **arrête-toi et demande** avant de continuer.
5. **Si un constat de l'audit est faux ou déjà corrigé** : ne force rien. Note-le dans le rapport de phase.
6. À la fin de chaque phase, écris le rapport de phase (format en § 16).

---

## 5. Commandes de vérification

```sh
pnpm install --frozen-lockfile
pnpm exec prisma generate --config=./prisma/prisma.config.ts

# Lint / tests / build par projet
pnpm nx lint  <app-mytradingcoach|admin-mytradingcoach|api-mytradingcoach|landing-mytradingcoach|shared>
pnpm nx test  <app-mytradingcoach|api-mytradingcoach|shared>
pnpm nx build app-mytradingcoach -c production
pnpm nx build admin-mytradingcoach -c production
pnpm nx build api-mytradingcoach -c production
pnpm nx build landing-mytradingcoach

# Graphe Nx (vérifier les dépendances entre projets)
pnpm nx show projects --affected --files=libs/shared/src/pricing.ts

# Duplication
pnpm dlx jscpd@4 apps libs --min-lines 8 --min-tokens 70 \
  --ignore "**/node_modules/**,**/dist/**,**/*.spec.ts,**/*.html,**/*.md,**/*.json,**/public/**"
```

> ⚠️ Environnement sans accès à `cdn.sheetjs.com` : `pnpm install` échoue tant que **DX-01** n'est pas fait. Commence donc par la phase 0.

---

## 6. PHASE 0 — Socle outillage (débloque tout le reste)

| ID | Tâche | Fichiers | Terminé quand… |
|---|---|---|---|
| DX-01 | Vendoriser `xlsx` : télécharger `xlsx-0.20.3.tgz` dans `vendor/`, puis `"xlsx": "file:vendor/xlsx-0.20.3.tgz"` (ou le remplacer par `exceljs` / `read-excel-file` si seule la lecture sert : vérifier les usages dans `csv-import`). | `apps/api-mytradingcoach/package.json`, `pnpm-lock.yaml`, `vendor/` | `pnpm install --frozen-lockfile` passe **sans accès réseau à sheetjs** ; les tests `csv-import` passent. |
| DX-02 | Épingler l'outillage : `"packageManager": "pnpm@11.6.0"`, `"engines": { "node": ">=22.23.2" }` à la racine, `engine-strict=true` dans `.npmrc`. | `package.json`, `.npmrc` | `corepack enable && pnpm -v` renvoie 11.6.0. |
| DX-03 | Corriger les exemples d'env : `DATABASE_URL` sur `localhost:5432` par défaut (pgbouncer absent du compose local), supprimer les mentions de `docker-compose.local.yml`, indiquer **quel fichier est lu par qui** (Nx lit `.env`, `ConfigModule` lit `.env.development` / `.env.local`, Prisma lit via `dotenv`). | `.env.example`, `.env.local.example` | Un clone neuf démarre l'API en suivant le README. |
| DX-04 | Réécrire le `README.md` (remplacer le README généré par Nx) : présentation en 3 lignes, prérequis, **démarrage en 7 commandes**, ports, comptes de démo, liens vers `CONTRIBUTING.md` et `.claude/agents/`. | `README.md` | Un junior lance app + API en moins de 15 min sans aide. |
| DX-05 | Scripts racine : `lint`, `test`, `build`, `typecheck`, `db:migrate`, `db:studio`, `db:reset`, `e2e`, `seed:demo` (via `nx run-many` / `prisma`). | `package.json` | Chaque script fonctionne. |
| DX-06 | Hooks git : `pre-commit` → `pnpm exec lint-staged` (prettier + eslint --fix sur les fichiers indexés) ; `commit-msg` → `pnpm exec commitlint --edit $1`. | `.husky/*`, `package.json` (`lint-staged`) | Un commit mal formaté est bloqué en local. |
| DX-07 | Supprimer les avertissements Vitest : renommer en `vitest.config.mts`, retirer `esbuild.target` (en conflit avec oxc). | `apps/*/vitest.config.ts` | Plus aucun warning au lancement des tests. |
| DX-08 | Déclarer `zod` dans les dépendances (dépendance fantôme utilisée par `trade.schema.ts`). | `package.json` | `grep zod package.json` le trouve. |

---

## 7. PHASE 1 — Nx : brancher `libs/shared` proprement (audit § 9.2, 9.3)

> **Pourquoi c'est prioritaire** : aujourd'hui, si `libs/shared/src/pricing.ts` change, Nx ne
> rebuild ni ne redéploie l'app et l'admin. L'API passe au nouveau prix, l'app garde l'ancien.

| ID | Tâche | Fichiers | Terminé quand… |
|---|---|---|---|
| NX-01 | Faire de `libs/shared` un paquet workspace : `libs/shared/package.json` avec `"name": "@mtc/shared"` et `exports` (`"@org/source": "./src/index.ts"`, `"default": "./src/index.ts"`). Créer `package.json` pour `app` et `admin` si besoin, et ajouter `"@mtc/shared": "workspace:*"` aux 4 apps (landing comprise, cf. LAND-03). | `libs/shared/package.json`, `apps/*/package.json` | `pnpm nx graph` montre `app → shared`, `admin → shared`, `api → shared`, `landing → shared`. |
| NX-02 | Supprimer les 6 alias manuels (`paths` des tsconfig d'apps, `resolve.alias` des vitest, alias webpack de l'API). | `apps/*/tsconfig*.json`, `apps/*/vitest.config.mts`, `apps/api-mytradingcoach/webpack.config.js` | Builds et tests verts **sans alias**. |
| NX-03 | Donner à `shared` ses cibles `test` et `typecheck` (vitest). Déplacer ses tests, aujourd'hui dans l'API (`common/utils/trade-stats.util.spec.ts`, `currency.util.spec.ts`), vers `libs/shared/src/*.spec.ts`. | `libs/shared/*`, `apps/api-mytradingcoach/src/common/utils/*.spec.ts` | `pnpm nx test shared` passe. |
| NX-04 | Vérifier l'impact : `nx show projects --affected --files=libs/shared/src/pricing.ts` doit lister **app, admin, api et landing**. | — | Sortie conforme. |
| NX-05 | CD : remplacer la détection `git diff HEAD~1 HEAD | grep ^apps/...` par `nx show projects --affected --base=<sha du dernier déploiement réussi> --head=HEAD`. Le SHA déployé est mémorisé (tag git `deployed/prod` déplacé après chaque déploiement réussi). | `.github/workflows/cd.yml` | Un changement dans `libs/` redéploie les apps concernées. |
| NX-06 | Tags et frontières : taguer chaque projet (`type:app / type:lib`, `scope:front / scope:back / scope:shared / scope:landing`) et remplacer la règle `'*' → ['*']` par de vraies contraintes : `scope:shared` n'importe que `scope:shared` ; `scope:front` ne peut pas importer `scope:back` et inversement. | `project.json` / `package.json` (`nx.tags`), `eslint.config.mjs` | Un import interdit fait échouer `nx lint`. |
| NX-07 | Documenter dans `.claude/agents/angular.md` et `nestjs.md` : comment consommer une lib et comment en créer une (`pnpm nx g @nx/js:lib libs/<nom> --bundler=none`). | `.claude/agents/*.md` | Section « Libs partagées » à jour. |

---

## 8. PHASE 2 — API : sécurité et robustesse (audit § 7.2)

| ID | Tâche | Fichiers | Terminé quand… |
|---|---|---|---|
| API-01 | `trust proxy` : `app.getHttpAdapter().getInstance().set('trust proxy', 1)` (un seul saut : Traefik). Documenter dans `security.md` et `deploy.md`. | `main.ts` | Test : avec `X-Forwarded-For`, `req.ip` = IP client. |
| API-02 | Limites dédiées sur l'auth : `@Throttle` sur `login` (5/min), `register` (5/min), `forgot-password` (3/min), `reset-password` (5/min), `demo-login` (10/min). Tracker = IP + email normalisé quand il est présent. | `auth.controller.ts`, guard throttler custom | Test e2e/unitaire : la 6ᵉ tentative renvoie 429. |
| API-03 | Stockage du throttler dans Redis (`@nest-lab/throttler-storage-redis`), pour une limite commune à tous les workers du cluster. | `app.module.ts` | Limite identique quel que soit le worker. |
| API-04 | Filtre d'exception **global** `@Catch()` : garder le format actuel (`statusCode`, `code?`, `message`, `timestamp`, `path`) pour **toutes** les erreurs ; mapper Prisma `P2002` → 409 `code: 'CONFLICT'`, `P2025` → 404 `code: 'NOT_FOUND'` ; le reste → 500 `code: 'INTERNAL'` sans fuite de détail. `path` = `request.path`, **sans la query string**. | `common/filters/http-exception.filter.ts` (+ spec) | Tests des 4 cas. |
| API-05 | Sentry : `instrument.ts` importé en premier dans `main.ts` (`Sentry.init` si `SENTRY_DSN`), plus `SentryModule.forRoot()` et `SentryGlobalFilter` (ou capture dans le filtre API-04 pour les 5xx). | `main.ts`, `instrument.ts`, `app.module.ts` | Une erreur 500 volontaire en dev remonte si le DSN est défini. |
| API-06 | Client Anthropic : `timeout` explicite (60 s), `maxRetries: 1`, journalisation des **échecs** (feature, durée, statut, sans contenu utilisateur), annulation si le client HTTP se déconnecte. **Lire la doc courante du SDK** avant de modifier. | `modules/shared/anthropic-client.service.ts`, `ai-logger.service.ts` | Test unitaire : échec journalisé, timeout pris en compte. |
| API-07 | Modèles IA centralisés : une constante `AI_MODELS` (coach, debrief, pattern, translation…) à côté de `ai-pricing.const.ts`. Plus aucun identifiant de modèle en dur dans les agents. Un test vérifie que chaque modèle utilisé a un tarif. | `modules/ai/agents/*`, `modules/shared/ai-*.ts` | `grep -rn "'claude-" modules/ai` = 0 hors constante. |
| API-08 | Cluster : redémarrage des workers avec délai croissant et plafond (ex. 5 redémarrages par minute, puis `process.exit(1)` pour laisser Docker relancer). | `main.ts` | Test manuel documenté dans la PR. |
| API-09 | `app.enableShutdownHooks()` et fermeture propre (queues BullMQ, Prisma, socket.io). | `main.ts`, services concernés | `docker stop` ne coupe plus de job en plein milieu (logs). |
| API-10 | Health check réel avec `@nestjs/terminus` : `/api/health` (liveness, sans dépendance) et `/api/health/ready` (Postgres + Redis). Mettre à jour le healthcheck Docker si pertinent. | `app.controller.ts` → `health/` | `ready` renvoie 503 si la base est coupée. |
| API-11 | Validation de l'environnement par un **schéma zod unique** dans `ConfigModule.forRoot({ validate })` : toutes les variables utilisées, avec les obligatoires en prod (`REDIS_HOST`, `CORS_ORIGINS`…). Supprimer `REQUIRED_ENV_VARS` en double dans `main.ts`. | `app.module.ts`, `config/env.schema.ts`, `main.ts` | Démarrage refusé avec un message clair si une variable manque. |
| API-12 | Mettre à jour `nestjs.md` et `security.md`. | `.claude/agents/*` | — |

---

## 9. PHASE 3 — Contrats partagés front/back (audit § 9.4, DX-5)

| ID | Tâche | Fichiers | Terminé quand… |
|---|---|---|---|
| CT-01 | Créer `libs/contracts` (TS pur, `scope:shared`, sans dépendance à Prisma, Angular ou Nest). | `libs/contracts/*` | Lib buildable, testée, visible dans le graphe. |
| CT-02 | Enums métier en `as const` (+ type dérivé) : `EmotionState`, `TradeSide`, `ExecutionGrade`, `TradingSession`, `Plan`, `Role`, `AccountType`, `AccountStatus`, `SessionStatus`, `MoodState`, `TradeSource`, `DrawdownType`, `ExecutionMethod`, `BrokerProvider`, `BrokerConnectionStatus`. **Un test côté API** vérifie l'égalité avec les enums Prisma générés. | `libs/contracts/src/enums.ts`, `apps/api/.../contracts-sync.spec.ts` | Le test échoue si Prisma et `contracts` divergent. |
| CT-03 | Types de réponse de l'API : commencer par `trades` (`Trade`, `TradeFilters`, pages), `analytics` (`AnalyticsSummary`…), `accounts`, `debrief`, `session`, `eco-calendar`. Supprimer les définitions locales : `Trade` défini 3 fois dans l'app (`trades.api.ts`, `trades.store.ts`, `scoring.component.ts`), `WeeklyDebrief` 2 fois, les interfaces de `admin/core/api/*`. | `libs/contracts/src/*`, `apps/app/.../core/api/*`, `apps/admin/.../core/api/*`, services Nest | `grep -rn "interface Trade\b" apps` = 0. |
| CT-04 | Schéma zod du trade partagé (`CreateTradeSchema`, `UpdateTradeSchema`), utilisé par le front (`trade-form`) et par un `ZodValidationPipe` côté Nest sur `POST/PATCH /trades` (décision D5). | `libs/contracts/src/trade.schema.ts`, `apps/api/.../trades` | Mêmes règles des deux côtés, tests des cas limites. |
| CT-05 | Déplacer dans `libs/shared` : `normalizeEventKey` / `eventKey` (aujourd'hui copiés dans `app/core/data/eco-event-key.ts` et `api/eco-calendar.service.ts:661`) et `todayParis` / `toParisDateStr` / `yesterdayParis` / `parisDayRange` (copiés dans `app/core/utils/paris-date.ts` et `api/common/utils/paris-date.ts`). | `libs/shared/src/*` | Une seule implémentation, tests déplacés. |
| CT-06 | Relancer jscpd : **0 clone entre projets**. | — | Rapport joint à la PR. |

---

## 10. PHASE 4 — Fondations front partagées (audit § 1.2, 2.1, 2.4, 9.4)

| ID | Tâche | Fichiers | Terminé quand… |
|---|---|---|---|
| UI-01 | Créer `libs/front/ui` (lib Angular, `scope:front`) et `libs/front/auth`. | `libs/front/*` | Libs dans le graphe, lint et tests verts. |
| UI-02 | **Tokens de design communs** `tokens.css`, importés par l'app et l'admin : couleurs (ceux de `app/styles/theme.css`), **échelles** de taille de texte (plancher 12 px, 11 px pour les capitales mono), d'espacement, de rayon, d'ombre, de z-index, et **4 breakpoints** (`--bp-sm: 480px`, `--bp-md: 768px`, `--bp-lg: 1024px`, `--bp-xl: 1280px`). Supprimer les alias hérités (`--text2`, `--color-profit`, `--bg-primary`…) par codemod. | `libs/front/ui/styles/tokens.css`, `apps/app/src/styles/*`, `apps/admin/src/styles.css` | Plus de token défini deux fois. `design.md` à jour. |
| UI-03 | **Contrastes AA** : fond des boutons primaires `#2563eb` (ou texte foncé), `--badge-free-color` ≥ `#6c84a6`, écart net entre `--text-2` et `--text-3` (ou fusion). Vérifier chaque paire texte/fond avec un calcul de contraste. | `tokens.css` | Toutes les paires ≥ 4,5:1 (texte normal) ou ≥ 3:1 (texte ≥ 18,66 px gras). |
| UI-04 | Règle globale `:focus-visible { outline: 2px solid var(--blue-bright); outline-offset: 2px; }`. Supprimer les `outline: none` sans remplacement (21 feuilles, dont `eco-calendar.component.css` sans aucun focus). | `tokens.css` / `global.css`, CSS des composants | Navigation au clavier visible partout. |
| UI-05 | `ConfirmDialog` basé sur `@angular/cdk/dialog` : piège de focus, Échap, retour du focus, `role="dialog"`, `aria-modal`, `aria-labelledby`, variante « danger ». Service `confirm(options): Promise<boolean>`. | `libs/front/ui/confirm-dialog/*` | Remplace **tous** les `confirm()` natifs (`accounts.component.ts:540`, `ambassadeurs.component.ts:280`) et la `confirm-modal` du journal. |
| UI-06 | Composant `<mtc-error-state>` (message, bouton « Réessayer », `role="alert"`) et `<mtc-empty-state>`. | `libs/front/ui/*` | Utilisés en phase 5. |
| UI-07 | `errorInterceptor` : toast générique pour les 5xx, 429 et erreurs réseau (`status 0`), désactivable par `HttpContextToken` (`SILENT_ERRORS`). Messages en français, via `apiErrorMessage`. | `libs/front/ui` ou `app/core/api`, `app.config.ts` (app + admin) | Test : un 500 affiche un toast ; une requête marquée silencieuse, non. |
| UI-08 | `BillingService.startCheckout(plan)` unique : loading, toast d'erreur, redirection. Remplace les 4 copies (`plan-modal`, `register`, `settings`, `analytics`). | `app/core/services/billing.service.ts` | `grep -rn "\.checkout(" apps/app` = 1 seul appel. |
| UI-09 | `libs/front/auth` : intercepteur JWT + refresh **unique**, paramétré par un token d'injection (`AUTH_CONFIG`). Remplace `app/core/auth/auth.interceptor.ts` et `admin/core/auth/admin-auth.interceptor.ts`. | `libs/front/auth/*` | Tests : refresh unique si plusieurs 401 simultanés ; logout si le refresh échoue. |
| UI-10 | Thème Chart.js partagé (couleurs, polices, grilles) : fusionner `app/core/services/chart.service.ts` et `admin/shared/charts/chart-theme.ts`. | `libs/front/ui/charts/*` | Un seul thème. |
| UI-11 | Toasts : un seul composant et service, dans `libs/front/ui`, utilisés par l'app **et** l'admin. | `libs/front/ui/toasts/*` | — |

---

## 11. PHASE 5 — App et admin : UX, UI, accessibilité, performance (audit § 1 à 5)

### 5.A États et erreurs
| ID | Tâche | Terminé quand… |
|---|---|---|
| APP-01 | Brancher `resource.error()` sur `<mtc-error-state (retry)="resource.reload()">` dans **Analytics, Scoring et Dashboard** (tous les `httpResource`). | Couper l'API en dev affiche l'état d'erreur, pas des zéros. |
| APP-02 | Afficher un état d'erreur dans les features qui n'en ont pas : eco-calendar, sessions, weekly-debrief (liste), referral, ambassador, become-ambassador, session-day. | Chaque écran gère loading, vide et erreur. |
| APP-03 | Recherche d'instruments (`trade-form`, `onboarding`, `quick-trade`) : distinguer « aucun résultat » et « recherche indisponible ». | Message différent selon le cas. |

### 5.B Navigation et contenu (décision D1)
| ID | Tâche | Terminé quand… |
|---|---|---|
| APP-04 | Appliquer les libellés validés en D1 dans la sidebar. Ranger **Scoring** dans « ANALYSE & IA », **Ambassadeur** et **Parrainage** dans « COMPTE ». **Ne pas changer les URLs** (liens emails, favoris). | Sidebar cohérente, URLs inchangées. |
| APP-05 | Tutoiement partout : SEO de `app.routes.ts` (« Connectez-vous », « Créez… ») et `not-found.component.html`. | `grep -rn "vous \|votre " apps/app/src` = 0 (hors cas justifié). |
| APP-06 | Remplacer les `toFixed()` d'affichage (49 occurrences) par les pipes `money` et `pnl-format`, localisés en `fr-FR`. | Montants au format `1 234,50 €`. |

### 5.C Accessibilité
| ID | Tâche | Terminé quand… |
|---|---|---|
| A11Y-01 | Login et register : `aria-label` et `aria-pressed` sur le bouton œil ; `aria-invalid` et `aria-describedby` reliant chaque champ à son erreur ; `role="alert"` sur l'erreur API. | Annonces correctes au lecteur d'écran (vérifier avec l'arbre d'accessibilité Playwright). |
| A11Y-02 | Burger mobile : `aria-expanded`, `aria-controls`, fermeture par Échap, focus envoyé dans le tiroir à l'ouverture et rendu au burger à la fermeture. | Test clavier OK. |
| A11Y-03 | Toutes les modales (16 templates) passent par CDK Dialog ou reçoivent `role="dialog"`, `aria-modal`, piège de focus et Échap. | 0 modale sans `role="dialog"`. |
| A11Y-04 | Cartes de choix de l'onboarding (`onboarding.component.html:410-429`) : vrais `<button>` au lieu de `div role="button"`. | Entrée **et** Espace fonctionnent. |
| A11Y-05 | Heatmap Analytics (`cellClass`) : valeur du win rate en texte ou en tooltip, et palette sûre pour les daltoniens. P&L : signe +/− toujours affiché en plus de la couleur. | Lisible en niveaux de gris. |
| A11Y-06 | Icônes seules (sidebar repliée, boutons d'action) : `aria-label` sur chaque bouton sans texte. | Audit axe (Playwright + `@axe-core/playwright`) sans violation « serious » ni « critical » sur login, dashboard, journal, analytics et settings. |
| A11Y-07 | Plancher typographique : aucune taille < 12 px (sauf capitales mono ≥ 11 px), via les échelles de UI-02. | `grep` des `font-size` < 11 px = 0. |
| A11Y-08 | Breakpoints : remplacer les 15 valeurs par les 4 tokens de UI-02. | Plus de breakpoint arbitraire. |

### 5.D Admin
| ID | Tâche | Terminé quand… |
|---|---|---|
| ADM-01 | Passer les 12 templates inline en `templateUrl` + `.html` (hors composants de moins de 30 lignes). Idem pour les 4 composants d'auth de l'app (`login`, `forgot-password`, `reset-password`, `demo-entry`). | Un seul style de template. |
| ADM-02 | Tableaux (14) : `<caption>` (visuellement masquée si besoin) et `scope="col"` sur les en-têtes. | — |
| ADM-03 | « Marquer comme payé » (ambassadeurs) via `ConfirmDialog` variante danger, avec le montant et le nom rappelés. | Plus aucun `confirm()` natif. |
| ADM-04 | Tests sur les écrans financiers : revenue, subscriptions, ambassadeurs (au moins le rendu des montants et l'action de paiement). | Specs ajoutées. |

### 5.E Performance
| ID | Tâche | Terminé quand… |
|---|---|---|
| PERF-01 | Analyser le bundle initial (`--stats-json` puis analyse esbuild), sortir ce qui peut être chargé en lazy, et ramener l'initial **sous 500 kB**. Ne pas relever le budget. | Build sans warning de budget. |
| PERF-02 | Routeur : `withPreloading(PreloadAllModules)` (ou stratégie ciblée) et `withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' })`. | Retour arrière dans le journal = même position. |
| PERF-03 | Auto-héberger les fontes (décision D7) avec `@fontsource/*`, en réduisant à environ 6 graisses. Supprimer les liens `fonts.googleapis.com`. | Aucune requête vers Google au chargement. |

---

## 12. PHASE 6 — API : conception des routes (audit § 7.3)

> ⚠️ Change des URLs appelées par l'app et l'admin : **front et back dans la même PR**, et
> garder les anciennes routes 1 version avec `@deprecated` et un log `warn` si le déploiement
> front et back n'est pas simultané.

| ID | Tâche | Terminé quand… |
|---|---|---|
| API-20 | Regrouper **toutes** les routes admin sous `/admin/*`, dans des contrôleurs protégés **au niveau de la classe** par `@UseGuards(AdminGuard)`. Déplacer `users/admin/*` (`stats`, `online`, `:id`, `:id/role`, `subscriptions`, `:id/detail`). | Aucune route admin hors `/admin`. Tests des guards à jour. |
| API-21 | Découper `TradesController` : `market` (`news`, `news/:id/text`, `market-context`, `live-price`) et `instruments` (`instruments`, `instruments/search`, `user-assets`, `favorite-asset`). | `trades.controller.ts` ne gère que les trades. |
| API-22 | Mettre à jour les services API du front (app + admin) et les types dans `libs/contracts`. | App et admin fonctionnels, e2e smoke vert. |

---

## 13. PHASE 7 — Landing (audit § 8)

| ID | Tâche | Fichiers | Terminé quand… |
|---|---|---|---|
| LAND-01 | **Supprimer `aggregateRating`** (décision D3). | `layouts/Base.astro:83` | Absent du HTML généré. |
| LAND-02 | JSON-LD : `SoftwareApplication` et `FAQPage` **uniquement sur la home**. La FAQ JSON-LD est **générée depuis la même source** que `FAQ.astro` (tableau `faq.ts`). Pages légales et 404 : `WebPage` / `Organization` seulement. | `Base.astro`, `components/FAQ.astro`, `src/data/faq.ts` | Texte FAQ visible = texte JSON-LD. |
| LAND-03 | Prix depuis `@mtc/shared` (`PREMIUM_PRICE_EUR`, `PREMIUM_ANNUAL_SAVINGS_EUR`) : `Pricing.astro`, `FAQ`, `Compare`, JSON-LD `Offer`. Respecter `plans.md`. | `components/*`, `Base.astro` | `grep -rn "49\b\|490" src` ne renvoie plus de prix en dur. |
| LAND-04 | `${APP_URL}/register` partout (23 liens en dur). | `Pricing`, `Nav`, `CtaFinal`, `Testimonials`, `BlogPost` | `grep -rn "app.mytradingcoach.app" src` = seulement `config.ts`. |
| LAND-05 | Blog en **collection de contenu** : un `pages/blog/[slug].astro` rendu via `getCollection('blog')`, articles en Markdown (migrer les 12 `.astro` ; pour les 5 articles en double, **garder la version `.astro`**, la plus récente), index généré et trié par `publishDate`. Conserver **exactement** les slugs actuels. | `src/content/blog/*`, `src/pages/blog/*` | Mêmes URLs, un seul fichier par article, sitemap identique. |
| LAND-06 | Composants non rendus : appliquer la décision D2 (brancher `Showcase`, `CoachIA`, `Debrief` et les mockups dans la home, ou les supprimer). | `pages/index.astro`, `components/*` | 0 composant orphelin. |
| LAND-07 | Sitemap : `lastmod` = `updatedDate ?? publishDate` pour les articles, omis ailleurs (plus de `new Date()`). | `astro.config.mjs` | `lastmod` stable d'un build à l'autre. |
| LAND-08 | Retirer `tailwindcss` et `@tailwindcss/vite` (inutilisés). Sortir les 326 `style="…"` inline vers le `<style>` du composant. | `package.json`, `src/**` | `grep -rc 'style="' src` ≈ 0 (hors valeurs dynamiques). |
| LAND-09 | Aligner TypeScript sur la racine (6.x). Ajouter `eslint-plugin-astro` et `prettier-plugin-astro`. Cible `lint` = eslint + `astro check` (nouvelle cible `typecheck`). | `package.json`, `project.json`, `eslint.config.mjs` | `pnpm nx lint landing-mytradingcoach` passe. |
| LAND-10 | Fontes auto-hébergées (D7) : supprimer le hack `media="print" onload`. | `Base.astro` | Aucun appel à Google. |
| LAND-11 | Pages gatées : documenter (dans `deploy.md`) une 301 Nginx à la place du `meta refresh` quand le flag est OFF. | `.claude/agents/deploy.md` | — |
| LAND-12 | Mettre à jour `CLAUDE.md` (URL `www.mytradingcoach.app`, après vérification de la 301 apex → www) et `astro.md`. | — | — |

---

## 14. PHASE 8 — Lisibilité pour un développeur junior (audit § 9.5)

| ID | Tâche | Terminé quand… |
|---|---|---|
| READ-01 | **Découper les fichiers de plus de 600 lignes**, à comportement strictement identique (tests existants verts avant et après) :<br>• `tradovate-connection.service.ts` (978) → `oauth`, `token-refresh`, `sync`, `mapping`<br>• `trades.service.ts` (857) → CRUD, `trade-metrics` (R/R, grade), `duplicates`, import<br>• `onboarding.component.*` (766 + 545) → un sous-composant par étape<br>• `demo-seed.ts` (762) → un fichier par type de données<br>• `eco-calendar.service.ts` (685) → fetch, traduction, favoris<br>• `settings.component.*` (657 + 597 + 712 CSS) → un composant par onglet<br>• `journal.component.ts` (615) → liste, filtres, modales | Aucun fichier TS de plus de 400 lignes hors tests et données. Règle eslint `max-lines: ['warn', 400]`. |
| READ-02 | Remplacer les **213 références `PROMPT-xxx`** (108 fichiers) par une phrase qui explique le pourquoi, ou par un lien vers une PR. | `grep -rn "PROMPT-[0-9]" apps libs` = 0. |
| READ-03 | Renommer le module Nest `modules/shared` en `modules/infra` (Redis, Anthropic, logger IA) pour lever la confusion avec `libs/shared` et `app/shared`. | Un seul « shared » : `libs/shared`. |
| READ-04 | Dossiers en anglais et alignés sur les URLs : `features/settings` → `features/profile` (route `/profil`), `features/session-day` → `features/today-session`, admin `ambassadeurs` → `ambassadors`, `surveillance` → `monitoring`. Ajouter une table **URL → dossier** dans `angular.md`. | Un junior trouve le dossier depuis l'URL. |
| READ-05 | Alias d'import par app (`@app/core/*`, `@app/shared/*`, `@app/features/*`, idem admin et API) pour supprimer les imports à 3 niveaux ou plus (113). | `grep -rE "from '(\.\./){3,}"` = 0. |
| READ-06 | Scripts : regrouper `scripts/*.mjs`, `apps/api/scripts/*` et `apps/api/src/scripts/*` dans `tools/scripts/{seed,backfill,ops}/`. Supprimer ou anonymiser les seeds personnels (`seed-gregory.mjs`, `seed-greg-june.mjs`). Un seul point d'entrée de seed démo. En-tête d'une ligne par script (but, usage). | Un seul dossier de scripts, documenté. |
| READ-07 | `CONTRIBUTING.md` (une page) : où mettre quoi (apps, libs, tags), créer une lib, conventions de nommage (code EN, UI FR tutoiement), commits, checklist de PR, commandes utiles. | Fichier créé et lié depuis README et CLAUDE.md. |
| READ-08 | `.claude/agents/*.md` : ajouter le frontmatter (`name`, `description`, `tools`) pour en faire de vrais sous-agents, **ou** les déplacer dans `docs/conventions/` et mettre à jour CLAUDE.md. Supprimer les configurations d'agents en double (`.github/agents`, `.github/prompts`, `.github/skills`, `.opencode/`) sauf si un outil les utilise vraiment. | Une seule source de conventions. |
| READ-09 | Ranger la racine : `VERIF-PRE-PROD.md` et `SMOKE-PROD.md` → `docs/`. Supprimer `docs/audit-ux-ui-landing-2026-09-27.zip` (doublon des captures versionnées). | Racine limitée aux fichiers de config. |

---

## 15. PHASE 9 — CI/CD et tests (audit § 6)

| ID | Tâche | Terminé quand… |
|---|---|---|
| CI-01 | Migrer les executors dépréciés : `pnpm nx g @nx/eslint:convert-to-inferred` et `pnpm nx g @nx/vitest:convert-to-inferred`. | Plus aucun warning de dépréciation. |
| CI-02 | Trouver et corriger la cause de `NX_IGNORE_UNSUPPORTED_TS_SETUP=true`, puis retirer la variable des workflows. | Build Angular OK sans la variable. |
| CI-03 | Workflow réutilisable (`workflow_call`) pour lint, test et build, appelé par `ci.yml` et `beta.yml`. | Plus de copie entre workflows. |
| CI-04 | Accélérer les tests de l'app (3 min 27 s aujourd'hui) : `pool: 'threads'`, essai de `happy-dom`, `isolate: false` pour les specs pures. **Mesurer avant et après** dans la PR. | Gain mesuré, suite verte. |
| CI-05 | Seuils de couverture API (lignes ≥ 60 % sur `trades`, `analytics`, `stripe`, `auth`). Retirer `passWithNoTests`. | CI échoue sous le seuil. |
| CI-06 | Supprimer le squelette `api-mytradingcoach-e2e` (Jest, `Hello API`), ou le réécrire en vrais tests d'API. | Plus de test fantôme. |
| CI-07 | Smoke E2E Playwright (décision D6) : login démo → dashboard → journal → analytics, sur un build statique avec API mockée **ou** base éphémère. Job non bloquant, puis bloquant après 2 semaines sans flake. Inclure l'audit axe (A11Y-06). | Job vert dans la CI. |
| CI-08 | Images Docker construites en CI, poussées sur GHCR avec tag SHA ; le VPS fait `docker compose pull` + `up -d` ; rollback = tag précédent (décision D4). Documenter dans `deploy.md`. | Déploiement prod sans build sur le VPS. |
| CI-09 | Budget Angular : laisser le build échouer au-dessus de 500 kB une fois PERF-01 fait (`maximumError` = seuil réaliste). | Un dépassement bloque la CI. |

---

## 16. Rapport à produire à la fin de chaque phase

```markdown
## Phase <n> — <titre>
- Branche / PR : …
- Tâches faites : ID — résumé (commit sha)
- Tâches non faites ou modifiées : ID — raison
- Constats de l'audit faux ou déjà corrigés : …
- Vérifications : lint ✅/❌ · tests ✅/❌ (nb, durée) · build ✅/❌ (tailles) · jscpd (%)
- Agents `.claude/agents/*` mis à jour : …
- Points d'attention pour la revue / le déploiement : …
```

## 17. Définition de « terminé » (toutes phases)

- [ ] `pnpm install --frozen-lockfile` fonctionne sans accès à un CDN tiers.
- [ ] Lint, tests et build verts pour les 4 apps et toutes les libs, sans variable de contournement.
- [ ] `nx graph` : chaque app dépend des libs qu'elle importe ; `enforce-module-boundaries` actif.
- [ ] jscpd : 0 clone entre projets ; aucun type d'API défini hors de `libs/contracts`.
- [ ] Aucun `confirm()` natif, aucune erreur API silencieuse, aucun contraste < AA.
- [ ] Audit axe sans violation « serious » ou « critical » sur les écrans clés.
- [ ] Aucun fichier TS de plus de 400 lignes hors tests et données ; 0 `PROMPT-xxx`.
- [ ] README, `CONTRIBUTING.md` et `.claude/agents/*` à jour.
- [ ] Landing : aucun prix ni URL d'app en dur ; aucune donnée structurée non vérifiable.
