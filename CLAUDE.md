# MyTradingCoach — CLAUDE.md

> Fichier de contexte global. Les règles techniques sont dans `.claude/agents/` (règles permanentes + checklist + index), le détail dans `.claude/reference/`.
> Pour les humains : `CONTRIBUTING.md` (où mettre quoi, conventions, checklist de PR).
> Claude Code lit ce fichier + les agents pertinents à chaque session.

---

## 🎯 Vision produit

**MyTradingCoach** — SaaS freemium de journal de trading intelligent pour le **trader futures francophone, souvent en évaluation ou en compte financé chez une prop firm** (Tradovate / NinjaTrader), qui trade lui-même. L'IA analyse émotions et comportements pour l'aider à tenir ses règles sous pression. L'app calcule aussi le forex et la crypto, mais ce n'est pas la cible.
➡️ **Cible, ton, interdits et offre : `.claude/contexte-com.md`** (fait foi pour tout texte visible).

**Plans** — 2 paliers (PROMPT-169) : FREE (0€, trades illimités, IA mutualisée), PREMIUM (49€/mois · 490€/an, IA personnelle). 14 jours de Premium offerts à l'inscription, sans carte, puis retour au gratuit (#769) ; ensuite aucun essai Stripe (mensuel prélevé à la souscription).
➡️ **Source de vérité plans / prix / features / gating / coût IA : `.claude/agents/plans.md`.** Ne pas dupliquer ni redéfinir les règles de plan ici.

---

## 🏗️ Monorepo

```
.claude/agents/     ← agents spécialisés (règles + checklist de vérification)
.claude/reference/  ← détail par domaine et fonctionnalités transverses (commun/)
.claude/commands/   ← commande /tache (circuit d'un prompt)
apps/
├── app-mytradingcoach/     ← Angular 22 (port 4200)
├── admin-mytradingcoach/   ← Angular 22 (back-office, accès ADMIN)
├── api-mytradingcoach/     ← NestJS 11 (port 3000 par défaut / conteneur, 3001 en dev local)
└── landing-mytradingcoach/ ← Astro 7 (port 4321)
prisma/schema.prisma

admin-mytradingcoach.html   ← référence design admin   ← LIRE AVANT TRAVAIL ADMIN
CLAUDE.md
​```

---

## 🖼 Référence design

La source de vérité du design, c'est le composant lui-même (`*.component.html`) plus les maquettes dédiées du dépôt (`maquette-*.html`). Les anciens miroirs globaux `app-mytradingcoach.html` et `landing-mytradingcoach.html` ont été retirés (commit `581875e`) et ne sont plus maintenus.

Pour l'app **admin**, la maquette `admin-mytradingcoach.html` (racine) reste LA référence : la lire avant de modifier l'admin, reproduire le design, ne pas inventer.


---

## 🎭 Compte démo — lecture seule (à garder en phase)

- `User.isDemo` (Prisma) : un compte démo voit l'app en **lecture seule**.
- `DemoReadOnlyGuard` (APP_GUARD, après `JwtAuthGuard`) bloque toute mutation (`POST/PUT/PATCH/DELETE`) si `user.isDemo` → `403 « Action non disponible en mode démo »`. Les `GET/HEAD/OPTIONS` passent toujours.
- Sécurité par défaut « tout bloqué sauf lecture » : une nouvelle mutation est protégée sans rien faire. Pour autoriser explicitement une route en démo → décorateur `@DemoAllowed()`.
- En conséquence : **enrichir le seed démo** pour chaque nouvelle feature à données (trades, débriefs, scoring…) afin que la démo reste représentative.

---

## 🧭 Agents à suivre selon la tâche (OBLIGATOIRE)

Avant de coder : lire les agents de la 2ᵉ colonne pour **chaque** ligne qui correspond au diff prévu (plusieurs lignes peuvent s'appliquer). Après : appeler **en parallèle** les vérificateurs de la 3ᵉ colonne sur le diff réel, puis **toujours en dernier le `relecteur`**, quel que soit le domaine.

| Si la tâche touche… | Agents à lire avant de coder | Agents vérificateurs après |
|---|---|---|
| `apps/api-mytradingcoach/**` | nestjs | nestjs, security (si auth, guards, secrets, données perso), tests |
| `prisma/schema.prisma`, `prisma/migrations/**` | prisma, nestjs | prisma, security |
| `prisma/seed*.ts` (seed démo, e2e, admin local) | prisma, nestjs | prisma, nestjs |
| `apps/app-mytradingcoach/**` | angular, design | angular, design, tests |
| `apps/admin-mytradingcoach/**` | angular, design (+ `admin-mytradingcoach.html`) | angular, design |
| `apps/landing-mytradingcoach/**` | astro, design | astro, design |
| `libs/shared/**` (`@mtc/shared` : contrats, calculs, constantes) | nestjs, angular | nestjs, angular, tests (+ plans si prix, durée, quota ou `PLAN_BENEFITS`) |
| `libs/front/auth/**` (`@mtc/front-auth`) | angular, security | angular, security |
| `libs/front/ui/**` (`@mtc/front-ui`) | angular, design | angular, design |
| prix, plans, essai, gating, quotas, offre fondateur, codes partenaires, e-mails liés aux plans | plans (+ le domaine du fichier) | plans |
| calculs de P&L, instruments, frais, R/R, drawdown | instruments (+ domaine) | instruments, tests |
| auth, JWT, OAuth broker, permissions, `.env`, rate limiting | security (+ domaine) | security |
| `.github/workflows/**`, `docker-compose*.yml`, `infra/**`, `tools/load/**`, `tools/load-tests/**`, `tools/scripts/**`, déploiement | deploy | deploy |
| textes visibles par les traders, e-mails, landing, posts | `.claude/contexte-com.md` (+ domaine) | relecteur (contenu) |
| tests ajoutés ou corrigés (`*.spec.ts`, `*.int-spec.ts`, `apps/*-e2e/**`) | tests | tests |
| `.claude/**`, `CLAUDE.md`, `CONTRIBUTING.md` (documentation, agents) | — | relecteur seul |

- Un agent se lit en entier (règles + checklist + index) ; ses fichiers `.claude/reference/…` seulement quand l'index dit qu'ils concernent la tâche.
- `decisions.md` fait foi sur les agents ; `contexte-com.md` fait foi sur les textes.

---

## 🚦 Workflow obligatoire

### Branche de départ
- **Tout** (feature, bug, optimisation, perf, refactor, dette, docs, CI…) → branche depuis `origin/dev` à jour (worktree dédié), livrée sur `dev`, puis `dev` → `main`. `beta` n'est plus utilisée pour les fonctionnalités (décision du 2026-11-08) : inutile de demander « nouvelle feature ou pas ? ».
- **Tout prompt passe par l'agent `relecteur`** : il valide, fait corriger et dirige la session (et les autres agents). **Aucun push tant qu'il n'a pas rendu « OK à 100 % »** (aucune correction restante, aucune question ouverte pour Greg). À 100 % → on pousse et on ouvre la PR vers `dev`, sans attendre de « OK push » de Greg. La PR `dev` → `main` n'est ouverte que sur demande explicite de Greg. **Seul Greg merge** (merge commit, jamais squash).

### Avant de coder
0. Prompt collé par Greg → l'enregistrer tel quel dans `.claude/prompts/PROMPT-<nom-du-prompt>.md` (texte exact, compléments ajoutés à la suite) et le commiter avec le travail : le relecteur lit ce texte-là.
1. Lire les agents « avant de coder » donnés par le tableau **« Agents à suivre selon la tâche »** (ci-dessous)
2. Lire `admin-mytradingcoach.html` avant tout travail sur l'app admin
3. Lire la maquette dédiée (`maquette-*.html`) si elle existe pour la vue concernée
4. Toute tâche touchant prix / features gated / accès par plan → lire `.claude/agents/plans.md` (cohérence obligatoire aux 4 points : landing, front, guard, cron).

### Pendant
5. Builder après chaque partie — zéro erreur avant de continuer
6. Ne jamais `npm` / `npx` → toujours `pnpm` / `pnpm dlx`

### Avant chaque arrêt pour Greg
**Rapport d'étape 0, questions, captures, fin de tâche** : appelle l'agent `relecteur` avec le prompt de la tâche, ton rapport et tes questions. Applique ses « Corrections à faire maintenant » et ses réponses, puis n'envoie à Greg **que** sa section « Pour Greg » avec ton résumé en 5 lignes maximum. Quand Greg prend une nouvelle décision, ajoute-la en haut de `.claude/decisions.md` (dans le même commit que le travail concerné). Quand Greg donne une nouvelle règle de com ou un nouveau chiffre qui change la stratégie, ajoute-le à `.claude/contexte-com.md` dans le même commit.

### Après
7. Commit atomique : `feat(scope):` / `fix(scope):` / `perf(scope):`
8. Dès qu'une feature ou un correctif change le comportement ou les règles : mettre à jour le **fichier de référence concerné** dans `.claude/reference/<domaine>/` (ou `reference/commun/` si plusieurs couches) — ou en créer un et l'ajouter à l'**index** de l'agent. **L'agent lui-même ne change que pour une règle permanente** (ou sa checklist). Domaines : schéma & migrations → `prisma` · DTO/back → `nestjs` · calcul P&L / instruments → `instruments` · plans/prix/gating/coût IA → `plans` · front → `angular` · landing → `astro` · déploiement → `deploy` · design → `design` · sécurité → `security` · tests → `tests`. Un déplacement de contenu se vérifie avec `.claude/scripts/verifier-references.sh` (aucune ligne perdue). Une référence périmée est pire que pas de référence.

---

## 🌐 URLs

```
Production
├── www.mytradingcoach.app       ← Landing (VPS/Nginx derrière Traefik ; l'apex redirige en 301 vers www)
├── admin.mytradingcoach.app     ← Admin Angular (VPS/Nginx derrière Traefik)
├── app.mytradingcoach.app       ← App Angular (VPS prod/Nginx derrière Traefik)
└── api.mytradingcoach.app       ← NestJS (VPS prod OVH Docker)

Dev
├── dev.app.mytradingcoach.app   ← App Angular dev (VPS/Nginx derrière Traefik)
└── dev.api.mytradingcoach.app   ← NestJS dev (VPS OVH port 3001)
```

Deux VPS OVH : **VPS prod** `149.202.40.240` (api., app., bases et Redis prod) et **ancien VPS**
`51.83.197.230` (dev, beta, landing www. et admin). Landing et admin restent sur l'ancien VPS :
**pas de Vercel**. L'admin n'a **pas d'environnement dev** (il part de `main` seulement).
Détails : `.claude/agents/deploy.md`.

---

## ❌ Pièges globaux

- `*ngIf` / `*ngFor` → `@if` / `@for`
- `npm` / `npx` → `pnpm` / `pnpm dlx`
- `console.log` NestJS → Logger NestJS
- Prisma dans controllers → passer par les services
- Essai = **14 jours offerts à l'inscription** (`PREMIUM_SIGNUP_TRIAL_DAYS`, sans carte) ; plus d'essai Stripe de 30 j pour les nouveaux inscrits (`trialUsed`), « 1 mois offert » = parrain seulement
- Quota FREE 30 trades/mois → **illimité** · Historique FREE → illimité
- Palier STARTER **supprimé** (PROMPT-169) : ne subsiste que FREE + PREMIUM
- Prix Premium = **49 €** · 490 €/an · valeurs en dur → `pricing.const.ts`
- CSS inline dans `.ts` → toujours dans `.css`
- `@nestjs/bull` → `@nestjs/bullmq`
- Compte démo (`isDemo`) : nouvelle mutation → déjà bloquée par `DemoReadOnlyGuard` (rien à faire) ; nouvelle métrique/agrégat admin ou cron/email ciblant des users → **exclure `isDemo: false`** ; nouvelle feature avec données → vérifier l'affichage démo + enrichir le seed

---

*MyTradingCoach — Juin 2026*
