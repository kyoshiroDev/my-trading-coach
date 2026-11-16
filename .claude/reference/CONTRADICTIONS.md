# Lignes remplacées lors du déplacement des agents (2026-11-16)

> Lu par `.claude/scripts/verifier-references.sh` : une ligne d'agent absente après déplacement doit figurer ici
> à l'identique (bloc « Avant »), avec le texte nouveau et la décision qui la remplace. Sinon elle est « manquante ».

## R1 — `.claude/reference/angular/features-gated.md`

**Raison** : C5 · décisions 2026-11-15 (E3, libellé harmonisé des paywalls) et 2026-11-14 (Q1, « 30 jours d'essai · carte requise », jamais « 1 mois offert ») ; code : `PaywallCtaService`, `TRIAL_LABEL`

Avant :

```text
modale de plans). `UserStore.trialAvailable()` (= `!trialUsed`) : la modale de plans ne promet
« 1 mois offert » que si l'essai est encore disponible, sinon le checkout facture tout de suite.
**Même règle sur TOUS les paywalls** (statistiques, score, insights, débrief, bannière du dashboard,
Profil, cadenas) : « Essayer Premium · 1 mois offert » si `trialAvailable()`, sinon « Passer à
Premium → » (et « Sans engagement · annulable en un clic » au lieu de « 1 mois offert · carte
requise »). Garde-fou : `plan-modal/trial-cta-copy.spec.ts` échoue sur une mention en dur.
```

Après :

```text
modale de plans). `UserStore.trialAvailable()` (= `!trialUsed`) : la modale de plans ne promet
l'essai Stripe (« 30 jours d'essai », `TRIAL_LABEL`) que s'il est encore disponible, sinon le checkout facture tout de suite.
**Même libellé sur TOUS les paywalls** (statistiques, score, insights, débrief, bannière du dashboard,
Profil, cadenas), un seul calcul `PaywallCtaService.label` (E3 #1013, décision du 2026-11-15), dans cet ordre :
offre fondateur ouverte → « Passer à Premium · 29 €/mois à vie (offre fondateur) → » (prix de `PRICING.founder`) ;
sinon `trialAvailable()` → « Essayer Premium · 30 jours d'essai → », mention « 30 jours d'essai · carte requise » ;
sinon « Passer à Premium → », mention « Sans engagement · annulable en un clic ». Jamais « 1 mois offert »
(réservé au mois offert du parrain). Garde-fou : `plan-modal/trial-cta-copy.spec.ts` échoue sur une mention en dur.
```

## R2 — `.claude/reference/commun/autopsie-669.md`

**Raison** : C5 · décision 2026-11-15 (E3)

Avant :

```text
- Gratuit : chronologie et constats ; carte IA verrouillée (« Essayer Premium · 1 mois offert » selon
  `trialAvailable`). Premium, `ai.status = 'pending'` : UN appel à `…/analysis` à l'ouverture.
```

Après :

```text
- Gratuit : chronologie et constats ; carte IA verrouillée (libellé unique des paywalls, `PaywallCtaService` :
  fondateur, sinon « Essayer Premium · 30 jours d'essai → » selon `trialAvailable`, sinon « Passer à Premium → »). Premium, `ai.status = 'pending'` : UN appel à `…/analysis` à l'ouverture.
```

## R3 — `.claude/reference/commun/entonnoir-premium.md`

**Raison** : C6 · décisions 2026-10-25 (essai d'inscription 14 j) et 2026-11-14 (Q1)

Avant :

```text
de l'essai (0 essai en prod au 2026-10-07, décision : garder 30 jours).
```

Après :

```text
de l'essai (0 essai en prod au 2026-10-07, décision : garder 30 jours ; remplacée le 2026-10-25 : 14 jours de
Premium offerts à l'inscription sans carte, essai Stripe 30 j seulement pour les comptes antérieurs jamais essayés, Q1 du 2026-11-14).
```

## R4 — `.claude/reference/commun/offre-fondateur.md`

**Raison** : C7 · décision 2026-11-14 (Q1)

Avant :

```text
- **Aucun essai** (premier paiement immédiat) ; l'essai 30 j du 49 € est inchangé.
```

Après :

```text
- **Aucun essai** (premier paiement immédiat) ; l'essai 30 j du 49 € est inchangé (comptes antérieurs à #769 jamais essayés seulement, Q1 du 2026-11-14).
```

## R5 — `.claude/agents/deploy.md`

**Raison** : C4 · fait technique (pas une décision) : `main.ts` `PORT ?? 3000`, API locale sur 3001 (`environment.ts`, tests.md)

Avant :

```text
pnpm nx serve api-mytradingcoach       # NestJS   → localhost:3000
```

Après :

```text
pnpm nx serve api-mytradingcoach       # NestJS   → localhost:3000 (port par défaut ; en dev local : PORT=3001, voir angular « Environments »)
```

## Frontmatter réécrit (étape 3) — agents devenus vérificateurs

**Raison** : prompt PROMPT-orchestration-agents, étape 3 : la `description` dit quand appeler l'agent comme vérificateur (et qu'il se lit avant de coder) ; `tools: Read, Grep, Glob, Bash` ajouté. Ancienne description de chaque agent :

```text
description: "Conventions de l'API NestJS : modules, routes, guards, DTO, erreurs, IA, crons. À lire avant tout travail dans apps/api-mytradingcoach."
description: "Conventions de l'app et de l'admin Angular (signals, zoneless, libs front partagées, modales, erreurs, routes). À lire avant tout travail dans apps/app-mytradingcoach ou apps/admin-mytradingcoach."
description: "Conventions de la landing Astro (structure, blog en collection, JSON-LD, prix et liens partagés, conformité NinjaTrader). À lire avant tout travail dans apps/landing-mytradingcoach."
description: "Déploiement et infra : VPS, Docker, Traefik, nginx statique, GitHub Actions, commandes Nx. À lire avant de toucher aux workflows, docker-compose ou à la mise en production."
description: "Système visuel « The Terminal » : couleurs, typographies, composants, accessibilité. À lire avant toute modification d'interface."
description: "Calcul du P&L par instrument (futures, forex, crypto) : ticks, multiplicateurs, frais. À lire avant de toucher aux calculs de trades ou aux instruments."
description: "Source de vérité des plans FREE/PREMIUM : prix, essai, features gatées, coût IA. À lire pour toute tâche touchant prix, accès par plan ou quotas (landing, front, guard, cron)."
description: "Schéma Prisma et migrations : conventions, index, compte démo. À lire avant de modifier prisma/schema.prisma ou d'écrire une migration."
description: "Sécurité : authentification, JWT, guards, variables d'environnement, rate limiting. À lire avant de toucher à l'auth, aux permissions ou aux secrets."
description: "Tests Vitest et Playwright : où les écrire, comment les lancer, pièges connus. À lire avant d'ajouter ou de corriger des tests."
```

## Règles du relecteur complétées (étape 4)

**Raison** : prompt PROMPT-orchestration-agents, étape 4 : « OK à 100 % » impossible sans le verdict revérifié de chaque
domaine touché ; le relecteur lit le tableau de routage et les références. Lignes d'origine de `relecteur.md` :

```text
2. `CLAUDE.md`, puis les agents concernés dans `.claude/agents/` (plans, angular, nestjs, astro, prisma, design, security, tests, deploy, instruments).
- Donner « OK à 100 % » s'il reste la moindre correction, un test non lancé ou une décision « Pour Greg » en attente ; merger ou approuver une PR, ouvrir une PR vers `main` sans demande explicite (voir « Ouverture des PR »).
```

## Référence périmée corrigée pendant le test à blanc (étape 5)

**Raison** : décision du 2026-11-15 (lot 3, C6 : clé unique `EcoEvent` élargie au pays, migration `20261116090000_eco_event_country_key`). Ligne d'origine (`nestjs.md`, « Calendrier éco : données FMP… ») :

```text
FMP révise ses prévisions après coup. La clé reste `(date, name, currency)`.
```
