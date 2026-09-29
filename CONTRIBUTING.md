# Contribuer à MyTradingCoach

Une page pour savoir où mettre quoi. Démarrage de l'environnement : voir le [README](README.md).
Règles détaillées par domaine : [`.claude/agents/`](.claude/agents) (seule source des conventions).

## Où mettre quoi

| Tu écris… | Va dans | Tags Nx |
|---|---|---|
| Un écran ou un composant de l'app | `apps/app-mytradingcoach/src/app/features/<écran>/` | `type:app` `scope:front` |
| Un écran du back-office | `apps/admin-mytradingcoach/src/app/features/<écran>/` | `type:app` `scope:front` |
| Une route, un service, un cron | `apps/api-mytradingcoach/src/modules/<domaine>/` | `type:app` `scope:back` |
| Une page ou une section du site public | `apps/landing-mytradingcoach/src/` | `type:app` `scope:landing` |
| Un type d'échange front ↔ API, un calcul, une constante (prix…) | `libs/shared/src/` (`@mtc/shared`) | `type:lib` `scope:shared` |
| Une brique d'interface pour l'app ET l'admin | `libs/front/ui/` (`@mtc/front-ui`) | `type:lib` `scope:front` |
| De l'auth front commune à l'app et l'admin | `libs/front/auth/` (`@mtc/front-auth`) | `type:lib` `scope:front` |
| Le schéma de base de données | `prisma/schema.prisma` + une migration | — |
| Un script ponctuel (seed, backfill, envoi) | `tools/scripts/{seed,backfill,ops}/` (voir son README) | `type:tool` |

Les frontières sont vérifiées par ESLint (`@nx/enforce-module-boundaries`) : une app ne dépend que
de libs ; le front n'importe jamais le back (et inversement) ; tout le monde peut importer `scope:shared`.

**Deux fois le même code ?** Si c'est du TypeScript pur (pas d'Angular, pas de Nest), il va dans
`@mtc/shared`. Si c'est de l'Angular utilisé par l'app et l'admin, dans `@mtc/front-ui`.

## Créer une lib

1. `pnpm nx g @nx/js:library --directory=libs/<scope>/<nom> --name=<nom>` puis ajouter les tags dans `project.json`.
2. Déclarer l'alias `@mtc/<nom>` dans `tsconfig.base.json` (et dans `resolve.alias` du
   `vitest.config.mts` de l'app si elle l'importe).
3. Tests : une cible `test` propre à la lib (l'exécuteur de tests de l'app refuse les fichiers hors de sa racine).

## Conventions

- **Code en anglais** (noms de fichiers, variables, fonctions) ; **interface en français, au tutoiement**.
- Imports : relatif au plus à 2 niveaux (`../../x`) ; au-delà, l'alias de l'app : `@app/core/…`,
  `@app/environments/environment`, `@admin/…`, `@api/common/…` (déclarés dans `tsconfig.base.json`).
- Angular : composants standalone, `OnPush`, signals, `@if` / `@for`, template et CSS dans leurs fichiers.
- Nest : pas de Prisma dans les contrôleurs (passer par un service), `Logger` plutôt que `console.log`,
  une route admin vit sous `/admin` dans un contrôleur gardé au niveau de la classe.
- Un commentaire explique **pourquoi**, pas ce que fait la ligne. Pas de référence à des numéros de
  ticket internes introuvables : écrire la raison.
- Compte démo en lecture seule : toute nouvelle mutation est bloquée d'office (`DemoReadOnlyGuard`) ;
  pense à enrichir le seed démo quand tu ajoutes des données.
- `pnpm` / `pnpm dlx` uniquement, jamais `npm` / `npx`.

## Taille des fichiers

ESLint avertit (`max-lines`, sans bloquer) au-delà de 400 lignes de code : c'est le signal pour sortir
la logique pure dans un fichier voisin (`*.helpers.ts`, `*.util.ts`, `*.model.ts`, testé à part) ou
un sous-composant. Fichiers encore au-dessus, à découper quand on y retouche :

- API : `ai/ai.service.ts`, `analytics/analytics.service.ts`, `eco-calendar/eco-calendar.service.ts`,
  `trades/csv-import.service.ts`, `trades/csv-parsers.ts`, `users/users.service.ts`
- App : `accounts/accounts.component.ts`, `eco-calendar/eco-calendar.component.ts`,
  `onboarding/onboarding.component.ts`, `profile/profile.component.ts`

## Commits

Conventionnels, sujet en **minuscules** (vérifié par commitlint) :
`feat(scope): …`, `fix(scope): …`, `perf(scope): …`, `refactor(scope): …`, `docs(scope): …`, `test(scope): …`.
Un commit = un changement cohérent.

## Checklist de PR

- [ ] `pnpm affected` passe (lint, typecheck, tests, build des projets touchés).
- [ ] Les états de chargement, vide **et erreur** sont gérés sur les écrans modifiés.
- [ ] Accessibilité : boutons avec un nom, modales avec `mtcDialog`, focus visible.
- [ ] Prix, plans ou accès modifiés : cohérence landing, front, guard et cron (`.claude/agents/plans.md`).
- [ ] L'agent concerné dans `.claude/agents/` est à jour si une règle a changé.

## Commandes utiles

| Commande | Rôle |
|---|---|
| `pnpm dev` / `pnpm dev:api` / `pnpm dev:admin` / `pnpm dev:landing` | Lancer une app |
| `pnpm affected` | Vérifier ce que ta branche touche |
| `pnpm nx test <projet>` | Tests d'un projet |
| `pnpm nx graph` | Graphe des dépendances |
| `pnpm db:migrate` | Nouvelle migration après modification du schéma |

Les dossiers `.github/agents`, `.github/skills`, `.opencode/` et `opencode.json` sont générés par Nx
(`nx configure-ai-agents`) pour d'autres assistants : ce ne sont pas des conventions du projet.
