---
name: tests
description: "À appeler pour vérifier un diff qui ajoute ou corrige des tests (*.spec.ts, *.int-spec.ts, apps/*-e2e), ou pour dire quels tests une modification exige. À lire aussi avant d'écrire un test."
tools: Read, Grep, Glob, Bash
---

# Agent Tests — Vitest + Playwright

## Vérification d'un diff

Appelé comme vérificateur : tu lis seulement le diff de ton domaine (`git diff origin/dev...HEAD -- apps libs`), les règles de cet agent et, dans l'index en bas, les seules références utiles au diff. Pas les agents des autres domaines. Tu ne modifies rien. Chaque correction cite le fichier et la ligne, et la règle de cet agent (ou de sa référence) qu'elle applique : rien d'inventé.

1. Tout test qui fixe une date fige l'horloge (`vi.useFakeTimers` + `vi.setSystemTime`, `freezeClock`), remise en état après chaque test.
2. Anthropic toujours mocké en CI.
3. `*.int-spec.ts` : `createIntegrationApp()` ; intégration seulement quand elle est nécessaire.
4. E2E : `data-testid`, jamais de sélecteur CSS ; données créées et nettoyées par test.
5. Typecheck des specs (`nx run-many -t typecheck`) en plus de test / lint / build.
6. Aucun test supprimé, `skip` / `only` ou seuil de couverture baissé.
7. Réécriture de calcul : test d'équivalence avant / après.
8. Tests critiques à maintenir toujours présents (`reference/tests/tests-critiques.md`).
9. Délai par test 20 s (`testTimeout`) ; limite d'inscription des E2E gérée (`LOAD_TEST_KEY`).

Réponse, toujours ce format, court :
```
Domaine : tests
Verdict : conforme | corrections nécessaires | bloquant
Corrections : liste numérotée (fichier:ligne, règle, correction)
Points pour le relecteur : ce qui sort de mon domaine ou demande un arbitrage
```
« bloquant » = règle non négociable violée (sécurité, argent, données, démo, prod) ; « corrections nécessaires » = écart à corriger avant push ; « conforme » = rien à corriger dans ton domaine.

---

## Stack
Vitest (Angular + NestJS) · Playwright (E2E) · Jamais Jest

---

## Commandes

```bash
pnpm nx test app-mytradingcoach        # Vitest Angular
pnpm nx test api-mytradingcoach        # Vitest NestJS
pnpm nx e2e app-mytradingcoach-e2e     # Playwright E2E
pnpm nx test api-mytradingcoach -c ci  # + couverture et seuils (ce que lance la CI)
```

### Vitest de l'app : specs non isolées

- `apps/app-mytradingcoach/vitest.config.mts` lance les specs **sans isolation** (`isolate: false`) :
  Angular et les libs sont importés une fois par worker, 240 s → 40 s. `src/test-setup.ts`
  initialise le TestBed une seule fois et le réinitialise avant/après chaque test.
- Une spec qui remplace un module avec **`vi.mock`** doit être ajoutée à `NEEDS_ISOLATION` dans ce
  fichier (projet Vitest `app-isolated`) : sinon le mock ne s'applique pas si un autre fichier a déjà
  chargé le module, et la spec casse selon l'ordre d'exécution.
- **Délai par test : 20 s** (`testTimeout`) dans les configs Vitest de l'app, de l'API, de l'admin
  (`vitest-base.config.ts` via `runnerConfig` du builder `unit-test`, #1133) et des libs front, au lieu
  des 5 s par défaut. Une spec qui compile un gros template réel (Mes comptes, journal, onboarding,
  profil) prend 1,5 à 4,3 s en suite complète, jusqu'à 14 s machine chargée ; idem côté API pour le
  câblage des modules Nest et la lecture Excel. Un échec « STACK_TRACE_ERROR » dans le rapport JSON
  avec une durée proche du délai = délai dépassé, pas une assertion fausse (#689). Ne pas baisser.
- Cibles Nx inférées (`@nx/vitest`, `@nx/eslint/plugin`) : pas de `test` ni de `lint` à déclarer
  dans `project.json`.

### En CI (`.github/workflows/checks.yml`, appelé par `ci.yml` et `beta.yml`)

- Un seul workflow réutilisable (`workflow_call`) : lint · typecheck · build, tests front + libs,
  tests API avec couverture, smoke E2E. Modifier les vérifications = modifier `checks.yml` seulement.
- **Seuils de couverture API** (`vitest.config.mts`) : lignes ≥ 60 % sur `modules/trades`,
  `analytics`, `stripe`, `auth`. Sous le seuil, `-c ci` échoue. Plus de `passWithNoTests`.
- **Smoke E2E** (`apps/app-mytradingcoach-e2e/src/smoke.spec.ts`) : `/demo` → dashboard → journal →
  analytics sur une base Postgres éphémère (migrations + `pnpm seed:demo`), API et app lancées dans
  le job. Échoue sur toute réponse API 5xx ou erreur console. **Non bloquant**
  (`continue-on-error`) : le rendre bloquant après deux semaines sans flake.
  L'app est servie en build **`local`** (`serve-static --buildTarget=app-mytradingcoach:build:local`
  → `environment.ts`, API `localhost:3001`) : le build par défaut `development` appelle l'API de
  dev du VPS. Le smoke échoue sur tout appel à `*api.mytradingcoach.app`.
  En local : `playwright test src/smoke.spec.ts` (le filtre `smoke` porte sur le chemin complet :
  dans un dossier dont le nom contient « smoke », il lance TOUTE la suite, inscriptions comprises)
  et `RESEND_API_KEY=re_placeholder` sur l'API, sinon les inscriptions envoient de vrais e-mails.
- **E2E de nuit** (`.github/workflows/e2e-nightly.yml`, #694) : `12-activation` (inscription +
  onboarding) chaque nuit à 02:30 UTC sur `dev`, base éphémère, API et app compilée lancées comme le
  smoke, `RESEND_DRY_RUN=true`. Sauté si aucun commit sur `dev` depuis 24 h (budget Actions) ;
  `workflow_dispatch` force le run. Actif seulement une fois le fichier sur `main` (planifié = branche
  par défaut).
- **Ports et API réglables, sans toucher aux fichiers compilés** : build **`e2e`** de l'app
  (`environment.e2e.ts`, aussi en `serve --configuration=e2e`) qui lit l'origine de l'API dans le
  localStorage (`mtc.e2e.apiOrigin`), posée par le `storageState` de `playwright.config.ts` depuis
  **`E2E_API_URL`** (défaut `http://localhost:3001`). Port de l'app : **`E2E_APP_PORT`** (défaut 4200,
  `BASE_URL` prioritaire). L'API garde `PORT` et `CORS_ORIGINS`. Exemple validé : API 3101, app 4310.
- **Limite d'inscription (10/h par IP)** : la suite crée un compte par test. Avec **`LOAD_TEST_KEY`**
  (même valeur côté API et Playwright, ≥ 32 caractères), `register()` ajoute la clé et un client virtuel
  propre au test aux seuls appels vers l'API (`page.route`), donc chaque test a son compteur
  (`load-test-tracker.ts`, ignoré sur la base de prod). Sans la clé : 2 échecs au 2e passage complet
  (11e et 12e inscriptions en 429). Jamais de purge Redis pour remettre les compteurs à zéro.

---

## Horloge : tout test qui fixe une date la fige (2026-11-08)

Deux tests ont cassé le 04/11 sans changement de code : ils fixaient une date (`NOW` au 03/11) mais
le code testé lisait l'heure réelle (`isPremiumAccess(user)` sans `now`, `new Date()` dans
`AccountsService.update`). Règle : un test qui écrit une date en dur fige l'horloge.

- API : `freezeClock(date)` (`src/test/freeze-clock.ts`) dans le `describe` (ou en tête de fichier) :
  `vi.useFakeTimers({ toFake: ['Date'] })` + `vi.setSystemTime`, `vi.useRealTimers()` après chaque test.
  Les délais (`setTimeout`) restent réels.
- Front : même chose à la main (`vi.useFakeTimers({ toFake: ['Date'] })`, `vi.setSystemTime`, `afterEach`).
- **Contrôle sous une autre date** (toutes les suites) : `tools/scripts/shifted-clock.mjs`, préchargé
  par Node dans chaque worker, décale `Date` dès le démarrage (puis l'horloge avance) :
  `TEST_NOW=2027-02-15T10:00:00Z NODE_OPTIONS="--import $PWD/tools/scripts/shifted-clock.mjs" pnpm nx test api-mytradingcoach --skip-nx-cache`.
  Un test qui change de résultat dépend de la date du jour. Témoin : `src/test/shifted-clock.spec.ts`.
  Limite : `NOW()` de Postgres ne bouge pas. Sous décalage, `signup-trial-funnel.int-spec.ts` échoue
  (données en heure JS, requête en `NOW()`) sans être fautif.

---

## Config Vitest NestJS

```typescript
// apps/api-mytradingcoach/vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: { provider: 'v8', thresholds: { 'src/modules/trades/**': { lines: 60 } /* … */ } },
  },
});
```

## Config Vitest Angular

```typescript
// apps/app-mytradingcoach/vitest.config.ts
import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';
export default defineConfig({
  plugins: [angular()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
  },
});
```

---

## Mock Anthropic — OBLIGATOIRE en CI

Ne jamais appeler la vraie API Anthropic en tests — coût + flakiness.

```typescript
// Dans les specs NestJS
vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn().mockResolvedValue({
    content: [{
      type: 'text',
      text: JSON.stringify({
        patterns: [{
          type: 'alert',
          title: 'Pattern revenge trading',
          description: 'Test description',
          severity: 'alert',
          badge: 'CRITIQUE'
        }]
      })
    }]
  });
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate }
  }));
  return { default: MockAnthropic };
});
```

```typescript
// Dans les specs Playwright — mocker les routes API
await page.route('**/api/ai/**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    insights: [{
      type: 'alert',
      title: 'Pattern revenge trading détecté',
      description: 'Après 2 pertes consécutives, win rate chute à 22%.',
      tag: 'CRITIQUE'
    }]
  })
}));

await page.route('**/api/debrief/generate', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    aiSummary: 'Bonne semaine dans l\'ensemble.',
    strengths: [{ badge: 'Force', text: 'Stops respectés à 100%' }],
    weaknesses: [{ badge: 'Critique', text: 'Jeudi après 15h : 4 pertes sur 5' }],
    objectives: [{ title: 'Stopper après 15h le jeudi', reason: 'Pattern détecté' }],
    stats: { winRate: 67, totalPnl: 1840, totalTrades: 28 }
  })
}));
```

---

## Règles générales E2E

1. `data-testid` sur TOUS les éléments interactifs — jamais de sélecteurs CSS
2. Chaque test crée ses propres données dans `beforeEach`
3. Toujours mocker les appels Anthropic en CI
4. `afterEach` nettoie les données pour éviter la pollution
5. Timeout default : 10s, navigation : 15s

## Typecheck : inclure les tests (2026-10-01)

`tsc -p apps/api-mytradingcoach/tsconfig.app.json` **exclut** les `*.spec.ts` / `*.int-spec.ts` :
un changement de signature (constructeur, méthode) peut passer en local et casser la CI. Vérifier
comme la CI : `pnpm nx run-many -t typecheck -p api-mytradingcoach` (ou `tsconfig.spec.json`).
`resend-neutralized.int-spec.ts` compare les méthodes du **prototype** de `ResendService` au double
`createResendMock()` : un helper interne ajouté au service doit être une propriété
(`private readonly x = () => …`), sinon le test échoue.

**Specs des libs front (`libs/front/ui`, `libs/front/auth`) : déjà typecheckées** (#1151, 2026-11-21).
Elles n'ont pas de cible `typecheck` propre, mais `apps/app-mytradingcoach/tsconfig.spec.json` inclut
`libs/front/{ui,auth}/src/**/*.ts` : la cible `typecheck` de l'app les vérifie (erreur de type ajoutée
exprès dans un spec de chaque lib → `tsc -p tsconfig.spec.json` de l'app échoue). L'app dépend des deux
libs dans le graphe Nx : un diff limité à une lib rend l'app « affected » et la CI relance son typecheck.
Ne pas ajouter de cible en double ; un nouveau dossier `libs/front/*` doit être ajouté à cet `include`.

## Test d'équivalence avant / après une réécriture (SCA-B2, 2026-10-02)

Pour réécrire un calcul sans changer ses résultats : figer l'ancienne implémentation dans
`src/test/<nom>-legacy.service.ts` (copie, commentaire « NE PAS MODIFIER »), générer un jeu
aléatoire **à graine fixe** et piégeux sur un vrai Postgres, comparer champ par champ (montants
≤ 0,01). Appeler les méthodes de calcul directement, **pas les `get*` en cache** (les deux versions
partageraient le cache Redis : test vrai par construction). Vérifier que le test **mord** en
sabotant volontairement le nouveau code une fois. Les tests unitaires qui simulaient
`prisma.trade.findMany` deviennent des scénarios d'intégration (`*.scenarios.int-spec.ts`).

---

## Détail déplacé (résumé)

- **`*.int-spec.ts` : TOUJOURS `createIntegrationApp()`** (PROMPT-209) — `reference/tests/suites-api.md`.
- **Tests critiques à maintenir** : `reference/tests/tests-critiques.md` ; ne jamais en supprimer un pour faire passer la CI.

---

## Index des références (`.claude/reference/`)

Contenu déplacé à l'identique le 2026-11-16. Lire un fichier seulement quand la tâche correspond à « quand le lire ».

| Fichier | Quand le lire |
|---|---|
| `tests/e2e-playwright.md` | tests E2E Playwright |
| `tests/suites-api.md` | test API unitaire ou d'intégration (`*.int-spec.ts`) |
| `tests/tests-critiques.md` | tests critiques NestJS et Angular à maintenir |
| `commun/autopsie-669.md` | autopsie d'un compte grillé (API, écran, schéma, tests) |
| `commun/compte-perdu.md` | compte échoué / archivé, agrégats qui les excluent |
