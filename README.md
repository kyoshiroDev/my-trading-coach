# MyTradingCoach

Journal de trading intelligent (SaaS freemium) : le trader enregistre ses trades, et l'IA analyse
ses émotions et ses comportements pour l'aider à progresser. Marchés : crypto, forex, actions, futures.

Monorepo [Nx](https://nx.dev) géré avec **pnpm**.

| Projet | Techno | Dossier | Port local |
|---|---|---|---|
| App (utilisateurs) | Angular 22 | `apps/app-mytradingcoach` | 4200 |
| Admin (back-office) | Angular 22 | `apps/admin-mytradingcoach` | 4300 |
| API | NestJS 11 + Prisma 7 | `apps/api-mytradingcoach` | 3000 |
| Landing (site public) | Astro 7 | `apps/landing-mytradingcoach` | 4321 |
| Code partagé | TypeScript pur | `libs/shared` (`@mtc/shared`) | — |

Base de données : PostgreSQL (`prisma/schema.prisma`). Cache et files de jobs : Redis.

---

## Prérequis

- **Node.js 22.23.2** (voir `.nvmrc` ; `nvm use` le sélectionne). Minimum : 22.22.3.
- **Corepack** activé : il installe automatiquement la bonne version de pnpm (champ `packageManager`).
- **Docker** pour PostgreSQL et Redis en local.

> ⚠️ Toujours `pnpm` / `pnpm dlx`, jamais `npm` / `npx`.

## Démarrage

```sh
corepack enable            # une seule fois par machine
pnpm install
cp .env.example .env       # valeurs de dev : fonctionnent telles quelles pour démarrer
pnpm db:up                 # PostgreSQL :5432 + Redis :6379 (docker compose)
pnpm db:deploy             # applique les migrations
pnpm db:generate           # génère le client Prisma
pnpm seed:demo             # optionnel : compte démo demo@mytradingcoach.app

pnpm dev:api               # API → http://localhost:3000/api (santé : /api/health)
pnpm dev                   # App → http://localhost:4200
```

Autres apps : `pnpm dev:admin` (http://localhost:4300) et `pnpm dev:landing` (http://localhost:4321).

Le compte démo est en **lecture seule** : l'API bloque toute écriture (`DemoReadOnlyGuard`).
Pour y accéder, ouvre http://localhost:4200/demo.

En local, l'IA est désactivée par défaut (`AI_ENABLED=true` dans `.env` pour l'activer, clé Anthropic requise).
Stripe, Resend, Tradovate et Discord n'ont besoin de vraies clés que pour tester ces intégrations.

## Commandes utiles

| Commande | Rôle |
|---|---|
| `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` | Sur tous les projets |
| `pnpm affected` | Lint, typecheck, tests et build des seuls projets touchés par ta branche |
| `pnpm nx test app-mytradingcoach` | Une cible sur un seul projet |
| `pnpm nx graph` | Graphe des dépendances entre projets |
| `pnpm db:migrate` | Crée une migration après modification de `schema.prisma` |
| `pnpm db:studio` | Explorer la base dans le navigateur |
| `pnpm db:reset` | ⚠️ Vide la base locale et rejoue toutes les migrations |
| `pnpm db:down` | Arrête PostgreSQL et Redis |

## Où trouver quoi

| Besoin | Où regarder |
|---|---|
| Règles globales du projet | `CLAUDE.md` |
| Conventions détaillées par domaine (Angular, NestJS, Prisma, plans et prix, design, sécurité, tests, déploiement) | `.claude/agents/*.md` |
| Plans, prix, fonctionnalités par plan | `.claude/agents/plans.md` et `libs/shared/src/pricing.ts` |
| Référence visuelle de l'admin | `admin-mytradingcoach.html` |
| Audits et plans de correction | `docs/` |

## Branches et workflow

| Branche | Environnement | Déploiement |
|---|---|---|
| `dev` | dev.app / dev.api | automatique au push (`ci.yml`) |
| `beta` | beta.app / beta.api (pré-prod) | automatique au push (`beta.yml`) |
| `main` | production | automatique après CI verte (`cd.yml`) |

1. Crée ta branche depuis la branche cible.
2. Commits conventionnels en minuscules, vérifiés par commitlint : `feat(scope): …`, `fix(scope): …`.
3. Avant de pousser : `pnpm affected`.
4. Ouvre une PR : la CI lance lint, typecheck, tests et build.
