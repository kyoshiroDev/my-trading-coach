# Librairie partagée `@mtc/shared`

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md`, `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Librairie partagée `@mtc/shared` (étape 3 de l'audit, 2026-09-13) · 2026-09-13 -->
> **Origine** : `nestjs.md` · « Librairie partagée `@mtc/shared` (étape 3 de l'audit, 2026-09-13) » · 2026-09-13

## Librairie partagée `@mtc/shared` (étape 3 de l'audit, 2026-09-13)

- `libs/shared/src` : code PUR commun à l'API, l'app et l'admin (aucune dépendance, aucun effet
  de bord). Aujourd'hui : `computeTradeStats` / `classifyTrade` (règle du win rate) et les valeurs
  tarifaires (`PREMIUM_PRICE_EUR`, `TRIAL_PERIOD_DAYS`, `ACCOUNT_LIMITS`,
  `PREMIUM_ANNUAL_SAVINGS_EUR`). Import : `from '@mtc/shared'`.
- Branchement (tous nécessaires) :
  - `tsconfig.base.json` : **seul** `paths` `@mtc/shared`, hérité par l'API, l'app, l'admin et
    `tsx` (seed). C'est aussi ce que Nx lit pour le graphe : sans lui, `nx affected` ne voyait
    pas que les apps dépendent de la lib. Ne jamais redéclarer `paths` dans un tsconfig d'app
    (il remplacerait celui de la base) ;
  - `tsconfig.app.json` de l'API : la lib dans `include` (projet `composite`) + `rootDir: ../..` ;
  - `webpack.config.js` : alias posé dans le hook `NodeModulesExternalsPlugin` (le plugin paths de
    Nx ne lit pas nos `paths`) ET `@mtc/*` exclu des externals — sinon `require('@mtc/shared')`
    au démarrage, introuvable dans node_modules ;
  - `vitest.config.mts` et `vitest.integration.config.mts` : `resolve.alias` (vitest ignore `paths`).
- Tests de la lib : dans `libs/shared/src/*.spec.ts`, lancés par `pnpm nx test shared`
  (plus dans l'API). Typecheck : `pnpm nx typecheck shared`.
- Frontières (`eslint.config.mjs`, `@nx/enforce-module-boundaries`) : tags `type:*` / `scope:*`
  sur chaque projet ; `libs/shared` (`scope:shared`) n'importe que lui-même, une app n'importe
  jamais une autre app, le front n'importe jamais l'API. Un import interdit casse le lint.
- Créer une nouvelle lib : `pnpm nx g @nx/js:lib libs/<nom> --bundler=none`, lui donner ses tags,
  puis déclarer son alias dans `tsconfig.base.json` (et dans les alias vitest / webpack si une
  app de test ou l'API l'importe).
- Ré-exporter une valeur de la lib : `export { X } from '@mtc/shared'` — jamais un import suivi de
  `export { X }`, effacé par la transpilation fichier par fichier (webpack : « export not found »).
- Pas de `tsconfig.json` dans `libs/shared` (volontaire) : le plugin TS de Nx y ajouterait des
  cibles et `nx sync` (lancé dans le Dockerfile) ajouterait aux apps des références vers une lib
  non composite, ce qui casse le build. Le typecheck de la lib lit `tsconfig.check.json`.
- Types d'API front/back (27 noms en double) : PAS encore partagés — les dates y sont `Date` côté
  API et `string` côté front (JSON) ; à traiter avec un type de transport dédié.

<!-- Origine : angular.md · Librairie partagée `@mtc/shared` (2026-09-13) · 2026-09-13 -->
> **Origine** : `angular.md` · « Librairie partagée `@mtc/shared` (2026-09-13) » · 2026-09-13

## Librairie partagée `@mtc/shared` (2026-09-13)

- Import `from '@mtc/shared'` (stats de trades, valeurs tarifaires) — source unique avec l'API.
  Détails et règles de la lib : `nestjs.md` § « Librairie partagée ».
- Branchement (voir `nestjs.md` § « Librairie partagée » pour la liste complète) : l'alias
  `@mtc/shared` est déclaré **une seule fois**, dans `tsconfig.base.json` (hérité par l'app et
  l'admin, et lu par Nx pour le graphe : une modif de la lib rebuild et redéploie les apps).
  Ne PAS redéclarer `paths` dans le tsconfig d'une app : cela écrase celui de la base.
  Vitest ne lit pas les `paths` : `resolve.alias` dans `apps/app-mytradingcoach/vitest.config.mts`.
  La lib reste dans l'`include` de `tsconfig.spec.json` de l'app (projet `composite`).
- `core/constants/pricing.const.ts` garde ses exports (`PRICING`, `ACCOUNT_LIMITS`,
  `yearlyPerMonth`) mais lit ses VALEURS dans `@mtc/shared` : un prix ne se change plus que dans
  `libs/shared/src/pricing.ts` (+ la landing `Pricing.astro`, non branchée à la lib).
