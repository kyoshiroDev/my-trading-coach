# Audit UI/UX + DX — MyTradingCoach (app, admin, API, landing, Nx, outillage)

- **Date** : 27/09/2026 · branche `claude/audit-ui-ux-dx-rnr1wi` (base `5fa7d9b`)
- **Périmètre** : `app-mytradingcoach` (Angular), `admin-mytradingcoach`, `api-mytradingcoach` (§ 7), `landing-mytradingcoach` côté code (§ 8), Nx et lisibilité (§ 9), monorepo, CI/CD, documentation.
  L'UX/UI de la landing en ligne a déjà son audit (`docs/audit-ux-ui-landing-2026-09-27.md`). La § 8 le complète côté code, SEO technique et build, sans le répéter.
- **Méthode** : lecture du code, scans statiques (grep), calcul des contrastes WCAG sur `styles/theme.css`, puis exécution réelle de `lint`, `test` et `build` pour l'app et l'admin.
  Pas de session navigateur : les constats UI viennent du code, pas de captures.
- **Mesures exécutées**

| Commande | Résultat |
|---|---|
| `pnpm install --frozen-lockfile` | ❌ échec : `xlsx` est téléchargé depuis `cdn.sheetjs.com` (§ DX-1) |
| `nx lint app-mytradingcoach` / `admin-mytradingcoach` | ✅ 0 erreur |
| `nx test app-mytradingcoach` | ✅ vert, mais **3 min 27 s** pour 59 fichiers de spec |
| `nx build app-mytradingcoach -c production` | ⚠️ **budget initial dépassé** : 592,7 kB pour un budget de 500 kB (transfert ≈ 111 kB) |
| `nx lint api-mytradingcoach` | ✅ 0 erreur |
| `vitest run` (API, unitaires) | ✅ 69 fichiers, 691 tests, **19 s** (après remplacement local temporaire de `xlsx` par la 0.18.5, non commité). Tests d'intégration (`*.int-spec.ts`, 9 fichiers) non lancés : ils demandent Postgres + Redis. |
| `nx build api-mytradingcoach -c production` | ✅ 9 s, `main.js` de 974 kB |
| `astro check` (landing) | ✅ 0 erreur, 0 warning, 1 hint |
| `astro build` (landing) | ✅ 21 pages en 2 s, `dist` de 872 kB |

Légende : 🔴 à traiter vite (bloque des utilisateurs ou des développeurs) · 🟠 important · 🟡 amélioration.

---

## Synthèse — top 13 (A = API, L = landing, N = Nx)

| # | Sév. | Constat | Où |
|---|---|---|---|
| 1 | 🔴 | Les erreurs API sont **silencieuses** sur Analytics, Scoring et Dashboard (`httpResource.error()` n'est jamais lu). Une panne ressemble à « aucune donnée ». | `analytics.component.ts:107`, `scoring`, `dashboard` |
| 2 | 🔴 | Le clic « Démarrer l'essai » depuis Analytics **ne fait rien** si Stripe échoue : l'erreur est avalée. | `analytics.component.ts:282` |
| 3 | 🔴 | Texte blanc sur `--blue` (#3b82f6) = **3,68:1** : les boutons primaires échouent au niveau AA. Badge FREE = **2,65:1**. | `styles/theme.css` |
| 4 | 🔴 | Un nouveau dev ne peut pas démarrer : `.env.example` pointe vers pgbouncer sur `:6432` et vers un `docker-compose.local.yml` qui **n'existent pas**. | `.env.example:9-12`, `docker-compose.yml` |
| 5 | 🔴 | `pnpm install` dépend d'un tarball hors registre (`cdn.sheetjs.com`). L'installation échoue dès que ce CDN est inaccessible (proxy, panne). | `apps/api-mytradingcoach/package.json:123` |
| 6 | 🟠 | Pas de style de focus global. 21 feuilles CSS font `outline: none`, dont 1 sans aucun `:focus` de remplacement et 10 avec un seul. | `eco-calendar.component.css` et autres |
| 7 | 🟠 | Navigation FR/EN mélangée, et « Ma session » côtoie « Mes sessions ». « Scoring » est rangé sous « ACCOUNT ». | `sidebar.component.html` |
| 8 | 🟠 | **30 % des tailles de police sont < 12 px** (279 sur 918), dont 166 à 9-10 px. | tous les `.css` |
| 9 | 🟠 | Les contrats front/back sont recopiés à la main (interfaces TS côté front, DTO class-validator côté back, schémas zod côté front). Pas d'OpenAPI ni de client généré. | `core/api/*.api.ts`, `core/schemas/trade.schema.ts` |
| A | 🔴 | **API derrière Traefik sans `trust proxy`** : le rate limiting (`ThrottlerGuard`, 60 req/min) compte probablement toutes les requêtes sous l'IP du proxy, donc un seul quota pour tous les utilisateurs. Et aucune limite dédiée sur `login`, `register` et `forgot-password`. | `main.ts`, `app.module.ts:47`, `auth.controller.ts` |
| N | 🔴 | **Nx ne voit pas `libs/shared`** : l'app et l'admin n'en dépendent pas dans le graphe. Si `pricing.ts` change, la CI (`affected`) et le CD ne rebuildent et ne redéploient que l'API, et l'app garde l'ancien prix. | `libs/shared`, `cd.yml`, § 9.2 |
| L | 🔴 | **Note 4,8/5 sur 24 avis codée en dur** dans le JSON-LD de toutes les pages de la landing, alors que la prod compte 4 traders. Risque d'action manuelle Google et de pratique commerciale trompeuse. | `landing/src/layouts/Base.astro:83` |
| 10 | 🟠 | Hook `pre-commit` vide. Les checks locaux reposent sur la CI seule. `commit-msg` utilise `npx` alors que la règle du projet l'interdit. | `.husky/` |

---

## 1. UI — système visuel

### 1.1 Contraste (WCAG 2.2, calculé sur les tokens)

| Token | sur `--bg` #080c14 | sur `--bg-card` #101d2e | Verdict |
|---|---|---|---|
| `--text` #e2eaf5 | 16,1 | 14,0 | ✅ |
| `--text-2` #8fa3bf | 7,6 | 6,6 | ✅ |
| `--text-3` #8398b5 | 6,6 | 5,8 | ✅ |
| `--text-faint` #6c84a6 | 5,1 | 4,4 | ⚠️ < 4,5 sur les cartes |
| `--badge-free-color` #4a6080 | **3,05** | **2,65** | ❌ |
| blanc sur `--blue` #3b82f6 (boutons) | — | **3,68** | ❌ en dessous de 14 px gras |
| `--red` #ef4444 | 5,2 | 4,5 | limite |

**Recommandations**
- 🔴 Assombrir le fond des boutons primaires (`#2563eb` donne ≈ 5,2:1 avec du blanc) ou utiliser un texte foncé.
- 🔴 Remonter `--badge-free-color` à au moins `#6c84a6`.
- 🟡 `--text-2` et `--text-3` ne diffèrent que de 1:1,1 : l'œil ne perçoit pas la hiérarchie. Il faut les écarter nettement, ou fusionner les deux tokens.

### 1.2 Tokens incomplets

- `theme.css` définit des couleurs et des polices, mais **aucune échelle** d'espacement, de rayon, de taille de texte, d'ombre ou de z-index. On trouve 2 241 `var(--…)`, mais les tailles restent en dur : 918 déclarations `font-size` en px, avec des valeurs comme 11.5px, 9.5px, etc.
- 🟠 **15 breakpoints différents** (480, 560, 600, 640, 700, 720, 760, 768, 769, 880, 900, 1100, 1200…). Il faut en choisir 3 ou 4 et les documenter dans `design.md`.
- 🟡 Des alias hérités (`--text2`, `--color-profit`, `--bg-primary`…) coexistent avec les noms actuels. Il faut les supprimer après un codemod.
- 🟡 L'admin a **son propre jeu de 29 tokens** (`admin/src/styles.css`). Aucune source commune avec l'app, donc les deux dérivent. Piste : `libs/shared/styles/tokens.css`, importé par les deux.

### 1.3 Typographie

- 🟠 279 tailles de police < 12 px sur 918, dont 166 entre 9 et 10 px (badges, axes, libellés mono). Sur mobile (DPR 2), c'est illisible pour une partie des utilisateurs. Le minimum conseillé est 12 px, et 11 px pour les capitales mono espacées.
- 🟡 Trois familles Google Fonts avec 11 graisses : Space Grotesk 500-700, Inter 400-800, JetBrains Mono 400-600.
  - **RGPD** : charger `fonts.googleapis.com` transmet l'IP du visiteur à Google. En Europe, c'est un risque juridique connu (jurisprudence allemande de 2022, position de la CNIL). Il vaut mieux auto-héberger les fontes (`@fontsource/*`).
  - **Performance** : ramener à environ 6 graisses.

---

## 2. UX — parcours et états

### 2.1 États d'erreur (🔴 priorité n°1)

- **`httpResource`** sert à Analytics, Scoring et Dashboard, mais **aucun `.error()` n'est lu nulle part** (vérifié par grep). Quand l'API tombe, la page affiche des zéros ou un état vide. L'utilisateur croit que ses trades ont disparu.
  → Ajouter un composant `<mtc-error-state (retry)>` partagé et le brancher sur `resource.error()`.
- **Pas d'intercepteur d'erreur global.** `authInterceptor` gère le 401 et `demoInterceptor` le 403 démo. Les 5xx, 429 et erreurs réseau remontent au composant, qui souvent ne fait rien. Les features sans affichage d'erreur détecté sont : analytics, eco-calendar, sessions, scoring, weekly-debrief (liste), referral, ambassador.
  → Ajouter un `errorInterceptor` qui envoie un toast générique pour les 5xx et les erreurs réseau (`status 0`), sauf si la requête porte un `HttpContext` qui le désactive.
- **Checkout Stripe avalé** (`analytics.component.ts:282`, commentaire `/* billing error : user stays on page */`). C'est le moment de conversion le plus important, et l'échec y est muet.
- **Checkout recopié 4 fois** : `plan-modal`, `register`, `settings`, `analytics`, chacun avec sa propre gestion d'erreur. Il faut le centraliser dans un `BillingService.startCheckout(plan)` (toast, loading, redirection).
- 🟡 Les recherches d'instruments font `catchError(() => of([]))` (trade-form, onboarding, quick-trade) : « API en panne » et « aucun résultat » s'affichent pareil.

### 2.2 Navigation et architecture de l'information

Libellés actuels de la sidebar :

```
OVERVIEW       Dashboard · Ma session · Mes comptes · Journal · Mes sessions · Analytics
ANALYSE & IA   IA Insights · Weekly Debrief · Calendrier éco · Ambassadeur · Parrainage
ACCOUNT        Scoring · Profil
```

- 🟠 **Langue mélangée** : OVERVIEW, ACCOUNT, Dashboard, Analytics et Weekly Debrief sont en anglais ; Mes comptes, Profil, Calendrier éco en français. Le produit est francophone : il faut choisir une langue et s'y tenir.
- 🟠 **« Ma session » et « Mes sessions »** sont deux entrées presque homonymes pour deux concepts différents (la session du jour et l'historique). Proposition : « Session du jour » et « Historique des sessions ».
- 🟠 **Scoring est classé sous ACCOUNT**, alors que c'est une analyse. **Ambassadeur et Parrainage sont sous ANALYSE & IA**, alors que ce sont des fonctions de compte ou de croissance.
- 🟡 Le tutoiement domine (476 occurrences), mais les métadonnées SEO et la page 404 vouvoient (`app.routes.ts:19`, `not-found.component.html:6`). Il faut unifier.

### 2.3 Formulaires

- Login (`login.component.ts`) :
  - Le bouton œil (l. 73) **n'a pas de libellé accessible**. Il faut `aria-label="Afficher le mot de passe"` et `aria-pressed`.
  - Les erreurs de champ ne sont pas reliées à l'input (`aria-invalid` et `aria-describedby` absents).
  - L'erreur API (l. 107) n'a pas `role="alert"` : un lecteur d'écran ne l'annonce pas.
- La validation est faite deux fois : zod côté front (`CreateTradeSchema`) et class-validator côté back. Les deux règles peuvent diverger. Voir DX-5.
- 🟡 Emoji dans le titre de connexion (« Bon retour 👋 ») : c'est un choix de ton, mais cela entre en conflit avec l'audit landing, qui relève l'usage d'emojis comme marqueur « template ».

### 2.4 Confirmations destructives

- 🟠 `confirm()` natif pour supprimer un compte de trading (`accounts.component.ts:540`) et pour **marquer un versement ambassadeur comme payé** (admin, `ambassadeurs.component.ts:280`). Une action financière irréversible passe par une boîte système non stylée et facile à valider par réflexe.
  L'app a déjà une `confirm-modal` (journal) : il faut l'extraire dans `shared/` et l'utiliser partout.

### 2.5 Données de trading

- 🟠 La heatmap Analytics (`cellClass`, l. 256) code le win rate **uniquement en vert, orange et rouge**, ce qui pose problème aux daltoniens. Environ 8 % des hommes le sont, et c'est la cible majoritaire. Il faut ajouter la valeur en texte ou au survol, ou une palette sûre (bleu / orange).
- 🟡 Même remarque pour P&L positif et négatif : doubler la couleur par un signe (+/−) ou une flèche. C'est probablement déjà fait par `pnl-format` : à vérifier écran par écran.
- 🟡 49 `toFixed()` dans les templates et le TS, alors que des pipes `money` et `pnl-format` existent. `toFixed` n'est pas localisé (`1234.5` au lieu de `1 234,50`) : il faut passer par les pipes.

---

## 3. Accessibilité (clavier et lecteurs d'écran)

| Point | Constat |
|---|---|
| Focus visible | 🟠 Aucun `:focus-visible` global dans `styles.css`. 21 CSS font `outline: none`. `eco-calendar.component.css` n'a **aucun** style de focus. → Ajouter une règle globale `:focus-visible { outline: 2px solid var(--blue-bright); outline-offset: 2px; }`. |
| Menu mobile | 🟠 Le burger (`sidebar.component.html:5`) n'a ni `aria-expanded` ni `aria-controls`. Le tiroir ne se ferme pas avec Échap, et le focus n'est ni piégé ni rendu au burger. |
| Modales | 🟠 16 templates contiennent une modale ou un overlay, mais seulement 10 `role="dialog"` / `aria-modal`. Pas de piège de focus commun. → Utiliser un `Dialog` CDK (`@angular/cdk/dialog`) ou une directive maison. |
| Cartes cliquables | 🟡 Les cartes de choix de l'onboarding (`onboarding.component.html:410-429`) sont des `div role="button"` qui réagissent à `Enter` mais **pas à `Espace`**. Mieux vaut de vrais `<button>`. |
| Annonces | 🟡 Les toasts ont bien un `aria-live`. Seuls 9 messages d'erreur ou de statut portent `role="alert"` ou `role="status"`. |
| Densité ARIA | 55 attributs `aria-*` pour 56 composants : c'est faible, pour une app riche en icônes seules (sidebar repliée, boutons d'action). |
| Mouvement | ✅ `prefers-reduced-motion` est géré dans 8 feuilles. À généraliser aux animations du dashboard live. |

---

## 4. Admin

- 🟠 **12 composants sur 15** ont leur template inline (`template:`) et 3 un `templateUrl`. C'est incohérent entre eux et avec l'app, où seuls les écrans d'auth (login, forgot, reset, demo-entry) sont inline. De gros templates inline se relisent mal en revue.
- 🟠 14 `<table>` et **aucun** `scope` ni `<caption>`. Pour un back-office dense en tableaux, il faut au minimum `scope="col"` sur les en-têtes.
- 🟠 Voir 2.4 : `confirm()` natif sur « marquer comme payé ».
- 🟡 7 attributs `aria-*` au total.
- 🟡 Seulement 7 fichiers de spec. Rien ne vérifie les écrans financiers (revenue, subscriptions, ambassadeurs).

---

## 5. Performance front

- 🟠 **Budget initial dépassé de 92,7 kB** (592,7 kB bruts, ≈ 111 kB transférés). La CI tolère l'avertissement, il est donc devenu invisible. Il faut soit ramener le bundle sous 500 kB, soit relever le budget explicitement. Un budget ignoré ne protège de rien.
  - `main` pèse 258 kB bruts. Il faut identifier ce qui est chargé en eager (`pnpm nx build … --stats-json` puis `esbuild analyze`).
  - Le plus gros chunk lazy (379 kB, sans nom) est probablement chart.js : vérifier qu'il n'est pas tiré par la sidebar ou le dashboard hors graphique.
- 🟡 Pas de `withPreloading` sur le routeur. Analytics (193 kB) et Session (160 kB) se téléchargent au clic. `PreloadAllModules` ou une stratégie ciblée améliorerait la réactivité perçue.
- 🟡 Pas de `withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })`. Le retour arrière depuis un trade peut perdre la position de scroll du journal.
- ✅ Zoneless, `OnPush` partout (57 composants), lazy loading de toutes les routes, signaux et `takeUntilDestroyed` (189 usages) : la base est saine.

---

## 6. DX — expérience développeur

### DX-1 🔴 Installation fragile
`"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"` : c'est la seule dépendance hors registre npm. Pendant cet audit, `pnpm install --frozen-lockfile` a échoué après 3 tentatives (`fetch failed`). Même risque en CI si le CDN tombe.
→ Vendoriser le tarball (`vendor/xlsx-0.20.3.tgz` + `"xlsx": "file:vendor/…"`), ou remplacer la lib par `exceljs` / `read-excel-file` si seule la lecture sert.

### DX-2 🔴 Démarrage local cassé tel que documenté
- `.env.example` mentionne `docker-compose.local.yml` (introuvable) et un pgbouncer sur `:6432`. Or `docker-compose.yml` ne lance que `postgres`, `redis` et `discord-bot`.
  → Soit ajouter pgbouncer au compose local, soit mettre par défaut `DATABASE_URL=…@localhost:5432/…` dans `.env.example`.
- `.env.local.example` renvoie lui aussi à `docker-compose.local.yml`.
- **Le README est le README par défaut de Nx** (« Your new, shiny Nx workspace… »). Il n'explique ni l'installation, ni le seed, ni les ports, ni les apps. Il faut le remplacer par un vrai « Getting started » en 10 lignes :

```sh
corepack enable              # pnpm épinglé via packageManager
pnpm install
cp .env.example .env
docker compose up -d postgres redis
pnpm db:migrate && pnpm seed:demo
pnpm dev:api   # :3000
pnpm dev       # :4200
```

### DX-3 🟠 Versions d'outillage non épinglées localement
- `package.json` n'a **pas de champ `packageManager`**. La CI épingle pnpm 11.6.0, mais en local chacun utilise sa version. Ici, pnpm 10 était installé alors que le lockfile et `pnpm-workspace.yaml` exigent la 11 (`allowBuilds`…), et Nx a même téléchargé pnpm 12.6.0 pendant l'exécution.
  → Ajouter `"packageManager": "pnpm@11.6.0"` et `"engines": { "node": ">=22.23" }`.
- `.nvmrc` indique 22.23.2, mais rien ne le fait respecter (`engine-strict` absent).

### DX-4 🟠 Hooks git et scripts
- `.husky/pre-commit` ne contient qu'un commentaire. Il faut `lint-staged` (prettier + eslint --fix sur les fichiers indexés) pour ne pas découvrir en CI ce qui prend 5 s en local.
- `.husky/commit-msg` : `npx --no -- commitlint`, alors que CLAUDE.md impose `pnpm dlx` / `pnpm exec`. Il faut `pnpm exec commitlint --edit $1`.
- Les scripts racine se limitent à `dev`, `dev:api`, `seed:demo`. Il manque des raccourcis : `lint`, `test`, `build`, `typecheck`, `db:migrate`, `db:studio`, `db:reset`, `e2e`.
- Les scripts one-shot sont répartis entre trois dossiers : `scripts/*.mjs`, `apps/api/scripts/`, `apps/api/src/scripts/`. Certains ont un nom personnel (`seed-gregory.mjs`, `seed-greg-june.mjs`). Il faut regrouper dans `tools/scripts/{seed,backfill,ops}/` et documenter chaque script en une ligne.

### DX-5 🟠 Contrat API recopié à la main
- `Trade` est défini dans `app/core/api/trades.api.ts:22`, alors que le back a ses DTO et que Prisma génère ses types. Pas de `@nestjs/swagger` ni d'OpenAPI.
- `libs/shared` (`@mtc/shared`) existe mais ne contient que stats, devises, prix et `api-error`.
- → Option légère : déplacer les types de réponse (`TradeDto`, `AnalyticsSummary`…) dans `libs/shared/contracts`, et partager les schémas zod entre le front et un `ZodValidationPipe` côté Nest.
  → Option complète : `@nestjs/swagger` avec génération du client (`openapi-typescript`) en CI.
- `zod` est une **dépendance fantôme** : le front l'importe (`trade.schema.ts`) sans la déclarer. Elle n'arrive que par transitivité et fonctionne grâce à `shamefullyHoist: true` (le commentaire de `pnpm-workspace.yaml` le reconnaît). Il faut la déclarer, puis viser à retirer `shamefullyHoist`.

### DX-6 🟠 Tests
- **App : 3 min 27 s** pour 59 fichiers, en jsdom et sans parallélisation fine. C'est trop lent pour tourner à chaque sauvegarde.
  → Essayer `pool: 'threads'` et `isolate: false` pour les specs purs (pipes, stores), ou `happy-dom`. Mesurer avant et après.
- Avertissements Vite à chaque exécution : `vitest.config.ts` en ESM chargé comme CJS, options `esbuild` et `oxc` en conflit. Renommer en `vitest.config.mts` et retirer `esbuild.target`.
- **E2E** : 13 specs Playwright (app et admin) ne tournent **jamais en CI** (`ci.yml:238`, « trop lent et trop fragile »). `api-mytradingcoach-e2e` est un résidu du générateur Nx sous Jest (`GET /api → 'Hello API'`) : à supprimer ou à écrire pour de vrai.
  → Commencer par un smoke Playwright de 3 scénarios (login démo → dashboard → journal) sur un build statique avec API mockée, en job non bloquant puis bloquant.
- API : `passWithNoTests: true` et aucun seuil de couverture. Il faut en ajouter un minimal (lignes ≥ 60 % sur `trades`, `analytics`, `stripe`) pour éviter les régressions sur le calcul du P&L.

### DX-7 🟡 CI/CD
- Les executors `@nx/eslint:lint` et `@nx/vitest:test` sont **dépréciés** (retirés dans Nx 24). Lancer `nx g @nx/eslint:convert-to-inferred` et `@nx/vitest:convert-to-inferred`.
- `NX_IGNORE_UNSUPPORTED_TS_SETUP=true` est nécessaire pour builder l'app : c'est un signal que la config TS (références de projets et `customConditions`) n'est pas alignée avec ce qu'attend Nx.
- `cd.yml` détecte les changements avec `git diff HEAD~1 HEAD`. Avec un merge commit, `HEAD~1` est le premier parent, donc tout est couvert. Mais un push direct de plusieurs commits sur `main` (ou un fast-forward) **peut sauter un déploiement**, car seul le dernier commit est comparé. Utiliser `nx affected --base=<sha déployé>` ou comparer à `github.event.workflow_run.head_sha^1` du merge.
- Le déploiement API fait `git reset --hard` puis `docker compose build` **sur le VPS de prod**. Construire l'image en CI et la pousser dans un registre (GHCR) rendrait les rollbacks triviaux (`docker compose pull` sur le tag N-1) et libérerait le CPU de prod.
- `beta.yml` recopie presque tout `ci.yml`. Un workflow réutilisable (`workflow_call`) éviterait la dérive.

### DX-8 🟡 Documentation et configuration des agents IA
- **`.claude/agents/*.md` n'a pas de frontmatter** (`name`, `description`). Claude Code traite ce dossier comme des définitions de sous-agents : ces fichiers ne sont donc pas de vrais agents invocables, seulement des documents lus « à la main ». Deux options :
  - les déplacer vers `docs/conventions/` (ou `.claude/rules/`) et les référencer depuis CLAUDE.md ;
  - leur ajouter un frontmatter pour en faire de vrais sous-agents.
- Trois configurations d'agents IA coexistent (`.claude/`, `.github/agents|prompts|skills`, `.opencode/`), avec des skills Nx en double. Choisir un outil principal.
- Racine encombrée de documents ponctuels (`VERIF-PRE-PROD.md`, `SMOKE-PROD.md`) : les ranger dans `docs/`.
- `docs/audit-ux-ui-landing-2026-09-27.zip` recopie le dossier de captures déjà versionné. C'est un binaire inutile dans git : à supprimer.

---

## 7. API (`api-mytradingcoach`)

### 7.1 Ce qui tient bien
- Architecture NestJS propre : guards globaux (`Throttler` → `JwtAuth` → `DemoReadOnly`), `ValidationPipe` strict (`whitelist` + `forbidNonWhitelisted` + `transform`), enveloppe `{ data }` uniforme, `helmet` avec CSP verrouillée.
- Liste des trades en **pagination par curseur** (`take: limit + 1`, `@Max(100)`), `select` ciblés dans l'analytics, cache Redis sur les agrégats.
- Point d'entrée IA unique (`AnthropicClientService`) avec interrupteur `AI_ENABLED` et journalisation du coût. Crons en opt-in (`IS_CRON_WORKER`).
- Tests unitaires rapides (691 tests en 19 s) et lint propre.

### 7.2 Sécurité et robustesse

| Sév. | Constat | Où | Recommandation |
|---|---|---|---|
| 🔴 | **Pas de `trust proxy`**. L'API est derrière Traefik (`docker-compose.prod.yml`), donc `req.ip` vaut l'IP du proxy. Le `ThrottlerGuard` global (60 req/min) regroupe alors tous les utilisateurs dans le même compteur : soit des 429 injustifiés en charge, soit aucune protection réelle par client. À confirmer dans les logs de prod (fréquence des 429). | `main.ts` | `app.getHttpAdapter().getInstance().set('trust proxy', 1)` (un seul saut : Traefik). |
| 🔴 | **Pas de limite dédiée sur l'authentification** : `login`, `register`, `forgot-password` et `reset-password` n'ont pas de `@Throttle`. Le brute-force et l'envoi massif d'emails de réinitialisation (coût Resend, spam) ne sont freinés que par le quota global. | `auth.controller.ts:40-97` | `@Throttle({ default: { ttl: 60_000, limit: 5 } })` sur `login` et `forgot-password`, et une clé IP + email. |
| 🟠 | Le stockage du throttler est **en mémoire, par worker**. En prod, `main.ts` lance un worker par cœur, donc la limite réelle vaut N × 60. | `app.module.ts:47` | Stockage Redis (`@nest-lab/throttler-storage-redis`), Redis étant déjà là. |
| 🟠 | Le filtre d'exception ne capte que `HttpException`. Les erreurs Prisma (`P2002` unique, `P2025` introuvable) et les exceptions inattendues passent par le filtre Nest par défaut. Le client reçoit alors un 500 **au format différent** (sans `code`, `timestamp`, `path`). Or le front s'appuie sur `code` (`apiErrorMessage`). | `common/filters/http-exception.filter.ts` | Filtre `@Catch()` global : mapper `P2002` → 409 et `P2025` → 404, et tout le reste en 500 au même format. |
| 🟠 | **Sentry installé mais pas initialisé** : `@sentry/nestjs` ne sert qu'à un `captureMessage` dans le webhook Stripe. Les 500 en prod ne sont remontés nulle part hors logs. | `stripe-webhook.service.ts:155` | `Sentry.init` dans un `instrument.ts` importé en premier, plus `SentryModule` et `SentryGlobalFilter`. |
| 🟠 | **Client Anthropic sans `timeout` ni `maxRetries` explicites** : par défaut, le SDK attend jusqu'à 10 min et retente 2 fois. Les endpoints synchrones `POST /ai/chat` et `/ai/insights` peuvent donc bloquer une requête HTTP et un worker très longtemps. Les appels en échec ne sont pas journalisés (seul le succès passe par `aiLogger`). | `modules/shared/anthropic-client.service.ts:7` | `new Anthropic({ timeout: 60_000, maxRetries: 1 })`, un `try/catch` qui journalise l'échec (feature, durée, statut), et un `AbortSignal` lié à la fermeture de la requête. |
| 🟡 | Le modèle est codé en dur dans 9 fichiers (`'claude-sonnet-4-6'` dans chaque agent). Changer de modèle oblige à tous les modifier, et le tarif dans `ai-pricing.const.ts` peut diverger. | `modules/ai/agents/*` | Une constante `AI_MODELS.coach / .debrief / .translation` à côté de la table de prix. |
| 🟡 | Le cluster relance un worker mort **immédiatement et sans limite**. Si un bug fait planter le démarrage, la boucle tourne indéfiniment et sature les logs et le CPU. | `main.ts:104-110` | Délai croissant et compteur (ex. 5 redémarrages par minute, puis `process.exit(1)` pour laisser Docker redémarrer le conteneur). |
| 🟡 | Pas d'`enableShutdownHooks()` : un `docker compose up --force-recreate` coupe les jobs BullMQ et les connexions Prisma et socket.io en cours. | `main.ts` | `app.enableShutdownHooks()` et fermeture propre des queues. |
| 🟡 | `/api/health` renvoie toujours `ok` sans tester Postgres ni Redis. Le healthcheck Docker reste vert quand la base est down. `@nestjs/terminus` est installé mais **inutilisé**. | `app/app.controller.ts:8` | `HealthCheckService` avec `PrismaHealthIndicator` et un ping Redis, ou retirer la dépendance. |

### 7.3 Conception de l'API (DX côté front)
- 🟠 **Routes admin dispersées** : `/admin/*` d'un côté, `/users/admin/*` de l'autre (`stats`, `online`, `:id/role`, `subscriptions`…). Un seul préfixe `/admin` protégé par un seul guard serait plus lisible et plus sûr : aujourd'hui, chaque route de `UsersController` doit penser à son `@UseGuards(AdminGuard)`.
- 🟠 **`TradesController` fourre-tout** (256 lignes) : `news`, `news/:id/text`, `market-context`, `live-price`, `instruments`, `user-assets` et `favorite-asset` ne sont pas des trades. Les ranger dans `market` et `instruments` clarifierait l'API et les droits.
- 🟡 **Validation de l'environnement partielle** : `validateEnv()` vérifie 9 variables, mais `REDIS_HOST` (déclarée obligatoire en prod dans `.env.example`), `CORS_ORIGINS` et `SENTRY_DSN` ne le sont pas. Trois mécanismes de chargement se superposent :
  - Nx charge `.env` ;
  - `ConfigModule` lit `.env.development` ou `.env.local` ;
  - `prisma.config.ts` fait `dotenv/config`.

  → Un seul schéma (zod ou Joi) dans `ConfigModule.forRoot({ validate })`, et un seul fichier documenté par environnement.
- 🟡 **Agrégats analytics calculés en JS** : l'API charge tous les trades de l'utilisateur, puis calcule en mémoire. C'est acceptable aujourd'hui grâce au cache et aux `select`. Au-delà de quelques milliers de trades par utilisateur, il faudra passer à `groupBy` ou à des vues SQL.
- 🟡 `path: request.url` dans les réponses d'erreur renvoie la query string. Vérifier qu'aucun token ne passe en query (lien de réinitialisation, OAuth Tradovate).

---

## 8. Landing — code, SEO technique et build (`landing-mytradingcoach`)

### 8.1 Ce qui tient bien
- Build statique très léger : 21 pages en 2 s, 872 kB en tout, 57 kB de HTML pour la home.
- `astro check` sans erreur. `trailingSlash: 'never'` et canonical cohérents. Sitemap filtré par les flags de feature.
- Un seul `<h1>` par page, `alt` sur toutes les images, meta description sur toutes les pages indexables, JSON-LD `Article` + `BreadcrumbList` sur les articles.
- Menu mobile et FAQ accessibles (`aria-expanded` mis à jour).

### 8.2 Constats

| Sév. | Constat | Où | Recommandation |
|---|---|---|---|
| 🔴 | **`aggregateRating` inventé** : `ratingValue 4.8`, `ratingCount 24`, codé en dur dans le JSON-LD par défaut. Il est donc injecté sur la home **et sur toutes les pages sans `schema` propre** : 404, CGU, mentions légales, disclaimer, confidentialité. Aucun système d'avis ne l'alimente, et l'API publique renvoie 4 traders. Cela enfreint les règles Google sur les données structurées (action manuelle possible, perte des rich results). En France, de faux avis relèvent aussi des pratiques commerciales trompeuses. | `layouts/Base.astro:83` | Supprimer `aggregateRating` tant qu'il n'y a pas de vrais avis vérifiables. |
| 🟠 | **FAQPage JSON-LD injecté sur toutes les pages**, pages légales comprises, et **recopié à la main** depuis `FAQ.astro`. Les deux textes vont diverger (réponse sur les prix, etc.). Google n'affiche plus les rich results FAQ pour les sites commerciaux depuis 2023. | `Base.astro:113`, `components/FAQ.astro` | Ne l'émettre que sur la home, généré depuis un tableau commun à `FAQ.astro`, ou le retirer. |
| 🟠 | **Prix codés en dur à 5 endroits** (`Pricing`, `FAQ`, `Compare`, JSON-LD `Offer`, JSON-LD FAQ), alors que `@mtc/shared` exporte `PREMIUM_PRICE_EUR`. C'est contraire à la règle « valeurs en dur → `pricing.const.ts` » de CLAUDE.md, et `plans.md` exige la cohérence landing, front, guard et cron. | `components/Pricing.astro:48-52`, etc. | Importer `@mtc/shared` (alias Vite) et interpoler. |
| 🟠 | **Collection de contenu morte** : `content.config.ts` déclare une collection `blog` (5 `.md`), mais **aucune page n'appelle `getCollection`**. Les 5 articles `.md` existent aussi en `.astro` sous `pages/blog/`, avec un texte qui a déjà divergé. L'index du blog liste les articles **à la main** (`const posts = [...]`). Publier un article demande donc 2 fichiers à synchroniser. | `src/content/blog/*`, `pages/blog/*.astro`, `pages/blog/index.astro:6` | Tout passer en collection Markdown/MDX, avec un `[slug].astro` et un index généré, ou supprimer la collection. |
| 🟠 | **2 270 lignes de composants jamais rendus** : `CoachIA`, `Debrief`, `Showcase` et les 6 `mockup/*` (déjà relevé par l'audit UX : aucune capture produit sur la home). Soit on les branche (ils répondent justement au manque de visuels produit), soit on les supprime. | `components/` | Décision produit, puis intégration ou suppression. |
| 🟠 | **23 liens `https://app.mytradingcoach.app/register` codés en dur** alors que `APP_URL` existe. Sur DEV, les inscriptions partent en prod (déjà relevé dans l'audit UX). | `Pricing`, `Nav`, `CtaFinal`, `Testimonials`, `BlogPost` | `${APP_URL}/register` partout. |
| 🟡 | **`lastmod` du sitemap = date du build** pour toutes les URLs : chaque déploiement annonce que tout a changé. Google finit par ignorer ce signal. | `astro.config.mjs` (`lastmod: new Date()`) | Utiliser `publishDate` / `updatedDate` des articles, ou omettre `lastmod`. |
| 🟡 | **Tailwind installé mais inutilisé** : `tailwindcss` et `@tailwindcss/vite` sont dans `package.json`, mais le plugin n'est pas branché et aucun import n'existe. En parallèle, **326 attributs `style="…"` inline**. | `package.json`, `src/**` | Retirer Tailwind, et sortir les styles inline dans les `<style>` des composants. |
| 🟡 | TypeScript `^5.9.2` sur la landing contre `6.0.3` à la racine. Pas d'ESLint ni de Prettier sur les `.astro` : la cible `lint` n'est qu'un `astro check` (typecheck). | `package.json`, `project.json` | Aligner TypeScript, ajouter `eslint-plugin-astro` et `prettier-plugin-astro`. |
| 🟡 | Google Fonts chargé depuis le CDN (même remarque RGPD et performance que l'app, § 1.3). `astro check` signale aussi le hack `media="print" onload` (hint `ts(6133)`). | `layouts/Base.astro:150-153` | Auto-héberger les fontes (`@fontsource`, ou le support `fonts` d'Astro). |
| 🟡 | Pages gatées (`/ambassadeur`, `/journal-trading-prop-firm`) générées comme redirections `meta refresh` à 2 s quand le flag est OFF. Elles sont bien exclues du sitemap et en `noindex`, donc c'est acceptable. Une redirection 301 côté Nginx serait plus propre. | `pages/*.astro` | Optionnel. |
| 🟡 | CLAUDE.md annonce `mytradingcoach.app`, mais `site` et les canonicals utilisent `www.mytradingcoach.app`. Vérifier que Nginx redirige bien l'apex vers `www` en 301, puis corriger la doc. | `astro.config.mjs`, `CLAUDE.md` | — |

---

## 9. Nx, duplication et lisibilité pour un développeur junior

### 9.1 Mesures

| Mesure | Résultat |
|---|---|
| Projets Nx | 9 : 4 apps, 3 e2e, `mtc-discord-bot` et **une seule lib** (`libs/shared`, 239 lignes) |
| Arêtes du graphe `app → shared`, `admin → shared` | **aucune**, alors que les deux importent `@mtc/shared` |
| `nx show projects --affected --files=libs/shared/src/pricing.ts` | `shared`, `api-mytradingcoach`, `api-mytradingcoach-e2e`. **Ni l'app ni l'admin.** |
| Copier-coller détecté (jscpd, ≥ 8 lignes) | 0,93 % (623 lignes sur 67 165). Code TS 0,5 %, CSS 2,3 %. **8 clones entre projets**, tous API ↔ front. |
| Fichiers de plus de 400 lignes (hors tests) | **25**, dont 8 au-dessus de 600 (`tradovate-connection.service.ts` : 978) |
| Références `PROMPT-xxx` dans le code | **213 dans 108 fichiers**, sans index consultable |
| Imports relatifs à 3 niveaux ou plus (`../../../`) | 113, dont 48 à 4 niveaux |

Le copier-coller brut est faible : le code n'est pas « dupliqué partout ». Le vrai problème, c'est la **duplication de sens**, que l'outil ne voit pas : les mêmes types, règles et algorithmes réécrits différemment dans plusieurs projets. Et Nx ne sait pas que les apps dépendent de `shared`.

### 9.2 🔴 Nx ne voit pas `libs/shared` : risque de déploiement incohérent

La lib est branchée **à la main, à 6 endroits** :
- `paths` dans `apps/app/tsconfig.json`, `apps/admin/tsconfig.json` et `apps/api/tsconfig.app.json` ;
- `resolve.alias` dans les deux `vitest.config.ts` ;
- l'alias webpack de l'API.

Pas de `package.json` dans la lib, pas de `paths` dans `tsconfig.base.json`. Nx ne détecte donc pas la dépendance (sauf pour l'API, via son `include`). Conséquences concrètes :
1. **CI** : `nx affected --target=build/lint` ne rebuild pas l'app ni l'admin quand `shared` change.
2. **CD** : `cd.yml` ne déploie l'app et l'admin que si un fichier de `apps/app-mytradingcoach/` ou `apps/admin-mytradingcoach/` change. Si le prix change dans `libs/shared/src/pricing.ts`, **seule l'API est redéployée**, et l'app continue d'afficher l'ancien prix.
3. **Cache Nx** : un build de l'app en cache peut être réutilisé alors que `shared` a changé.
4. **Junior** : ajouter une lib demande de connaître 6 fichiers de config que rien ne documente en un seul endroit.

**Correctif** (le workspace est déjà en mode « TS solution », avec `composite` et `customConditions: ["@org/source"]`) :
```jsonc
// libs/shared/package.json
{ "name": "@mtc/shared", "private": true, "type": "module",
  "exports": { ".": { "@org/source": "./src/index.ts", "default": "./src/index.ts" } } }
// apps/*/package.json (en créer un pour app et admin) → "dependencies": { "@mtc/shared": "workspace:*" }
```
Ensuite :
- supprimer les 6 alias manuels ;
- faire détecter les apps impactées au CD avec `nx show projects --affected` au lieu du `grep` sur les chemins ;
- ajouter à `shared` des cibles `test` et `typecheck`. Ses tests vivent aujourd'hui dans l'API (`common/utils/trade-stats.util.spec.ts`, `currency.util.spec.ts`), ce qui est trompeur.

### 9.3 🟠 Frontières de modules non définies

`eslint.config.mjs` a bien `@nx/enforce-module-boundaries`, mais avec `sourceTag: '*' → onlyDependOnLibsWithTags: ['*']`, c'est-à-dire **aucune règle**. Les apps n'ont pas de tags (`app` et `admin` : `[]`).
→ Poser `type:app | type:feature | type:data-access | type:ui | type:util` et `scope:front | scope:back | scope:shared`, avec des contraintes du type « une lib `scope:front` ne peut pas importer `scope:back` » et « `scope:shared` n'importe que `scope:shared` ». Un junior est alors arrêté par le lint au lieu d'une revue.

### 9.4 🟠 Duplication de sens à factoriser

| Dupliqué | Où | Cible proposée |
|---|---|---|
| **Types du contrat API** : `Trade` défini **3 fois dans l'app seule** (`trades.api.ts`, `trades.store.ts`, `scoring.component.ts`), `WeeklyDebrief` 2 fois. 62 interfaces dans `app/core/api`, 26 dans `admin/core/api`, et des clones exacts avec les services Nest (`eco-calendar`, `session`, `debrief`, `vps`, `user-detail`). | app, admin, API | `libs/contracts` (types de requêtes et réponses et enums), importé par les trois |
| **Enums Prisma** (15 enums : `EmotionState`, `TradeSide`, `ExecutionGrade`…) réécrits en unions de chaînes côté front | `trades.api.ts`, `trade.schema.ts`, `session.store.ts`, `quick-trade`… | Exporter les enums depuis `libs/contracts`, sans dépendance à Prisma : un simple `as const` synchronisé par un test |
| **Validation** : zod côté front (`trade.schema.ts`) et class-validator côté back | app, API | Schéma zod unique dans `libs/contracts`, avec un `ZodValidationPipe` côté Nest |
| **`normalizeEventKey`** : même algorithme copié. Le commentaire front dit « DOIT rester identique au backend ». | `app/core/data/eco-event-key.ts`, `api/eco-calendar.service.ts:661` | `libs/shared` : un commentaire ne garantit rien, un import si |
| **Dates Paris** (`todayParis`, `toParisDateStr`) | `app/core/utils/paris-date.ts`, `api/common/utils/paris-date.ts` | `libs/shared/date` |
| **Intercepteur JWT avec refresh** : même algorithme réécrit (file d'attente `BehaviorSubject` pendant le refresh) | `app/core/auth/auth.interceptor.ts`, `admin/core/auth/admin-auth.interceptor.ts` | `libs/front/auth` (lib Angular), paramétrée par le service d'auth |
| **Design tokens** (29 variables dans l'admin, 60+ dans l'app) et configuration Chart.js (`chart.service.ts` contre `chart-canvas` et `chart-theme.ts`) | app, admin | `libs/front/ui` : `tokens.css`, thème chart, `ConfirmDialog`, `ErrorState`, toasts |
| **Checkout Stripe** (4 copies, § 2.1) et **confirmations** (`confirm()` natif) | app, admin | `BillingService` et `ConfirmDialog` dans `libs/front/ui` |
| **Seeds démo** : `admin/demo-seed.ts` (762 l.), `scripts/seed-demo.ts`, `scripts/seed-demo-account.ts`, plus 3 seeds `.mjs` à la racine (dont 2 personnels) | API, racine | Un seul module de seed, avec des points d'entrée fins |
| **Prix** en dur dans la landing (§ 8.2) | landing | `@mtc/shared` : Astro peut l'importer via Vite |

Structure cible, simple à expliquer à un junior :
```
libs/
├── shared/          ← TS pur, sans framework : prix, devises, dates, stats, eventKey (déjà là)
├── contracts/       ← types + enums + schémas zod de l'API (front ET back)
└── front/
    ├── ui/          ← tokens.css, ConfirmDialog, ErrorState, Toasts, thème Chart.js
    └── auth/        ← intercepteur JWT + refresh, guards génériques
```
Règle d'or à écrire dans CLAUDE.md : « si le code est utilisé par deux projets, il va dans `libs/`, et Nx le vérifie ».

### 9.5 🟠 Lisibilité pour un développeur junior

1. **Références `PROMPT-xxx`** : 213 occurrences dans 108 fichiers (« corrigé PROMPT-213 », « PROMPT-169 »…). Pour quelqu'un qui arrive, ce sont des identifiants de sessions de travail introuvables : ni tracker ni index.
   → Remplacer par le **pourquoi** en une phrase. Si une trace est utile, pointer vers une issue ou une PR GitHub (`#228`), qu'on peut consulter.
2. **Fichiers trop longs** : 25 fichiers de plus de 400 lignes. Un junior doit lire 700 à 1 000 lignes pour comprendre un écran ou un service. Découpages proposés :
   - `tradovate-connection.service.ts` (978) → `oauth`, `token-refresh`, `sync`, `mapping` ;
   - `trades.service.ts` (857) → CRUD, calculs (R/R, grade), doublons, import ;
   - `onboarding.component.ts` (766) + `.html` (545) → un sous-composant par étape ;
   - `settings.component.*` (657 + 597 + 712 CSS) → un composant par onglet (profil, abonnement, préférences, danger) ;
   - `journal.component.ts` (615) → liste, filtres, modales.

   Repère : viser moins de 300 lignes par composant ou service. Le lint peut l'imposer (`max-lines` en `warn` à 400).
3. **Trois sens du mot « shared »** : `libs/shared` (lib Nx), `apps/api/src/modules/shared` (module Nest : Redis, Anthropic, logger IA) et `apps/app/src/app/shared` (composants UI). Renommer le module Nest en `modules/infra` ou `core`.
4. **Noms incohérents entre route, dossier et libellé** :

   | Route | Dossier | Libellé du menu |
   |---|---|---|
   | `/profil` | `features/settings` | Profil |
   | `/parrainage` | `features/referral` | Parrainage |
   | `/session` | `features/session-day` | Ma session |
   | `/sessions` | `features/sessions` | Mes sessions |

   L'admin mélange `ambassadeurs` et `surveillance` (FR) avec `users` et `subscriptions` (EN). Code et dossiers devraient être **toujours en anglais** et l'UI en français : un junior doit pouvoir deviner le dossier depuis l'URL.
5. **Imports relatifs profonds** : 113 à 3 niveaux ou plus, par exemple `../../../../core/api/trades.api`. Des alias par app (`@app/core/*`, `@app/shared/*`) ou les libs ci-dessus les suppriment.
6. **Deux styles de templates** : inline dans 12 composants admin et 4 composants d'auth de l'app, `templateUrl` ailleurs. Choisir `templateUrl` partout, sauf pour les composants de moins de 30 lignes.
7. **Scripts dispersés** (§ DX-4) et **README générique** (§ DX-2) : ce sont les deux premiers fichiers qu'ouvre un nouvel arrivant.
8. **Un bon point à garder** : les commentaires expliquent souvent le *pourquoi*, pas le *quoi* (ex. `http-exception.filter.ts`, `pnpm-workspace.yaml`). C'est la bonne pratique. Il faut seulement retirer les références `PROMPT` qui les rendent opaques.

### 9.6 Ordre de mise en œuvre conseillé
1. **Brancher `libs/shared` proprement** (`package.json` + `workspace:*`) et passer le CD sur `nx affected`. C'est court, et ça supprime le risque de déploiement incohérent.
2. Créer `libs/contracts`. Y migrer `Trade`, les enums et le schéma zod des trades, puis les autres modules au fil de l'eau.
3. Définir tags et contraintes `enforce-module-boundaries`.
4. `libs/front/ui` (tokens, ConfirmDialog, ErrorState) et `libs/front/auth`.
5. Découper les 8 fichiers de plus de 600 lignes, et remplacer les `PROMPT-xxx` quand on touche un fichier (règle « boy scout »).
6. Documenter tout ça dans un `CONTRIBUTING.md` d'une page : où mettre quoi, comment ajouter une lib (`nx g @nx/js:lib libs/xxx`), conventions de nommage.

---

## 10. Plan d'action proposé

**Sprint 1 — bloquants (≈ 2-3 j)**
0. Nx : `libs/shared` en paquet workspace (`workspace:*`) et CD basé sur `nx affected` (§ 9.2).
1. `errorInterceptor` global, composant `<mtc-error-state>` branché sur `httpResource.error()` (Analytics, Scoring, Dashboard), `BillingService.startCheckout` unique.
2. Contrastes : bouton primaire en `#2563eb`, badge FREE, règle `:focus-visible` globale.
3. DX : vendoriser `xlsx`, `packageManager`/`engines`, corriger `.env.example` (port 5432) et réécrire le README.
4. API : `trust proxy`, `@Throttle` sur l'auth, stockage du throttler dans Redis.
5. Landing : retirer `aggregateRating`, remplacer les URLs `register` en dur par `APP_URL`.

**Sprint 2 — cohérence (≈ 3-4 j)**
- API : filtre d'exception global (Prisma → 409/404), `Sentry.init`, `timeout` Anthropic, health check réel, routes admin sous un seul préfixe.
- Landing : prix depuis `@mtc/shared`, FAQ JSON-LD générée depuis une source unique, blog en collection, choix sur les composants morts.
4. Renommer la navigation (langue unique, « Session du jour » / « Historique », Scoring dans Analyse).
5. `ConfirmDialog` partagé (CDK Dialog avec piège de focus) pour remplacer les `confirm()` et unifier les 16 modales. Burger avec `aria-expanded` et fermeture par Échap.
6. Tokens : échelles de taille, d'espacement et de rayon ; 4 breakpoints ; plancher de 12 px ; tokens partagés app/admin.
7. `lint-staged` en pre-commit, scripts racine, rangement des scripts.

**Sprint 3 — fond (continu)**
- Nx : `libs/contracts`, `libs/front/ui`, `libs/front/auth`, tags et frontières de modules. Découper les fichiers de plus de 600 lignes, remplacer les `PROMPT-xxx`, écrire `CONTRIBUTING.md` (§ 9.3 à 9.6).
8. Contrats partagés (`libs/shared/contracts` + zod partagé, ou OpenAPI).
9. Smoke E2E en CI, seuil de couverture API, accélération de Vitest.
10. Images Docker construites en CI (GHCR), détection `nx affected` dans le CD, migration des executors Nx.
11. Auto-hébergement des fontes, bundle initial sous 500 kB.

---

## Ce qui est déjà bien

- Architecture Angular moderne et homogène : zoneless, `OnPush` partout, `@if`/`@for` (aucun `*ngIf`), aucun style inline dans les `.ts`, toutes les routes en lazy loading.
- Lint propre sur l'app et l'admin, tests verts.
- Sécurité par défaut (`DemoReadOnlyGuard`, variables d'env critiques vérifiées au démarrage, `helmet`, `ValidationPipe`), overrides de sécurité pnpm documentés.
- Documentation interne riche et tenue à jour (`.claude/agents/*`, ~4 100 lignes), commits conventionnels imposés en CI.
- `prefers-reduced-motion` pris en compte, toasts `aria-live`, `data-testid` systématiques.
