# Couche HTTP, découpage et migration (audit de septembre 2026)

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : angular.md · Couche HTTP, erreurs et templates (étape 4 de l'audit, 2026-09-13) · 2026-09-13 -->
> **Origine** : `angular.md` · « Couche HTTP, erreurs et templates (étape 4 de l'audit, 2026-09-13) » · 2026-09-13

## Couche HTTP, erreurs et templates (étape 4 de l'audit, 2026-09-13)

- **Aucun `HttpClient` dans un composant** : tout appel passe par `core/api/*.api.ts`
  (`AiApi` créé pour cooldown / insights / chat ; `TradesApi.importCsv`, `DebriefApi.exportPdf`,
  `AnalyticsApi.getDailyEquityCurve` ajoutés). Un type de réponse propre à un écran reste dans
  l'écran : la méthode d'API le reçoit en générique (`importCsv<ImportResult>`,
  `insights<InsightsResponse>`). `trades.store` passe aussi par `TradesApi.getAll`, typé sur la
  vraie page de l'API (`TradesPage` : `data` + `nextCursor` + `hasNextPage`, pagination par
  curseur ; l'ancien `PaginatedTrades` à `meta` n'existait pas côté back). Un seul type `Trade`
  (celui de `trades.api.ts`), ré-exporté par le store. Dans un spec, la query d'une requête
  construite avec `HttpParams` se lit dans `request.urlWithParams`, pas `request.url`.
- **Un seul helper d'erreur** : `apiErrorMessage(err, repli)` vit dans `@mtc/shared` (sans
  Angular), ré-exporté par `core/utils/api-error.ts` ; l'admin l'importe directement. Plus de
  `err.error?.message ?? …` en ligne ni de `tradovateErrorText`.
- **Templates de plus de ~150 lignes → `templateUrl` (.html)** : 12 composants migrés
  (session-live, dashboard, csv-import, session-morning, session-day, sidebar, sessions,
  debrief, ai-insights, register ; admin : user-detail, emails). Un spec qui lisait le template
  dans le `.ts` lit maintenant `.ts` + `.html` (cf. `csv-import-*.spec.ts`).
- Mock de `TradesApi` dans un spec qui intercepte le HTTP : lui donner une méthode qui émet la
  vraie requête (`TestBed.inject(HttpClient).delete(...)`), pour garder `HttpTestingController`.

<!-- Origine : angular.md · Découpage dashboard / session-live (audit, 2026-09-13) · 2026-09-13 -->
> **Origine** : `angular.md` · « Découpage dashboard / session-live (audit, 2026-09-13) » · 2026-09-13

## Découpage dashboard / session-live (audit, 2026-09-13)

- **Dashboard** : le parent garde l'état (période, compte, `httpResource`), le chrome des
  panneaux (`.mtc-panel` + en-tête) et les **états vides** ; chaque viz est un composant de
  `panels/` qui ne reçoit que des données prêtes (`input`). Les calculs vivent dans
  `dashboard-charts.util.ts` (fonctions pures, testées dans `dashboard-charts.util.spec.ts`).
  Les specs du dashboard lisent des membres du parent (`summary`, `baseCapital`,
  `currentCapital`, `accountReallyEmpty`, `dashboardPeriod`, `setPeriod`, `plGranularity`,
  `plTitle`, `periodRange`, `showCsvImport`) : ne pas les déplacer dans un panneau.
- **Session live** (v3) : le parent garde le cadre (CTA sans session, grille `.lv-grid`, feuille
  Contexte). La **connexion du WebSocket éco** est dans `SessionStore` depuis SCA-B4 (voir
  « Polling »). Bandeau, prochaine annonce, trade en cours, suivi du compte, trades clôturés, trade
  rapide et news (ticker + modale) sont dans `session-live/components/`.
- **CSS encapsulée** : le style d'une viz vit dans SON composant (un sélecteur du parent ne
  descend pas dans l'enfant). L'hôte d'un panneau de grille est un flex colonne
  (`:host { display:flex; flex-direction:column; min-width:0; min-height:0 }`) et le bloc
  interne s'étire (`flex:1`) : c'est ce qui reproduit l'étirement de la grille d'avant. Les
  `@container` fonctionnent dans les composants enfants (conteneur résolu dans le DOM).
  Une règle partagée par deux panneaux (`.pulse-dot`, `.col-title`) est dupliquée dans chacun,
  keyframes comprises (Angular préfixe les `@keyframes` d'un composant).
- Vérification d'un tel découpage : empreinte de mise en page (tag, classes, position, taille
  de chaque élément hors hôtes `mtc-*` et icônes) avant / après sur beta avec le compte démo,
  plus un script qui vérifie que chaque classe utilisée par un template a sa règle dans le CSS
  du même composant.

<!-- Origine : angular.md · Migration Angular 22 / Nx 23 / TypeScript 6.0 (étape 5 de l'audit, 2026-09-13) · 2026-09-13 -->
> **Origine** : `angular.md` · « Migration Angular 22 / Nx 23 / TypeScript 6.0 (étape 5 de l'audit, 2026-09-13) » · 2026-09-13

## Migration Angular 22 / Nx 23 / TypeScript 6.0 (étape 5 de l'audit, 2026-09-13)

- Faite par `nx migrate latest` + `--run-migrations` (Angular 22.1.6, CLI/build 22.1.8, Nx 23.2.1,
  TypeScript 6.0.3 — Angular 22 exige TS `>=6.0 <6.1`, donc **pas TypeScript 7**).
- **Migration `safe-optional-chaining` volontairement NON appliquée** : en Angular 22, `a?.b` dans un
  template suit la sémantique JS (`undefined`, plus `null`). La migration aurait entouré les 76 `?.`
  de `$safeNavigationMigration(…)` pour garder `null`. Aucun n'était comparé à `null` et l'affichage
  est identique (`??` traite les deux pareil). Règle désormais : ne pas écrire `=== null` sur le
  résultat d'un `?.` dans un template ; une entrée typée `T | null` qui reçoit un `?.` le verra au
  build (strictTemplates).
- `strict-safe-navigation-narrow` : les diagnostics `nullishCoalescingNotNullable` et
  `optionalChainNotNullable` sont mis en `suppress` dans les `tsconfig.app.json`.
- TypeScript 6 : `ignoreDeprecations: "6.0"` et, dans `tsconfig.base.json`, `types: ["*"]` +
  `noUncheckedSideEffectImports: false` pour garder le comportement de TS 5 (TS 6 change ces défauts).
  Chaque tsconfig a un `rootDir` explicite : `../..` pour l'app, l'admin et leurs specs (ils incluent
  `libs/shared`), sinon `@mtc/shared` sort de la racine et TypeScript refuse le fichier.
