# MyTradingCoach — CLAUDE.md

> Fichier de contexte global. Les règles techniques détaillées sont dans `.claude/agents/`.
> Pour les humains : `CONTRIBUTING.md` (où mettre quoi, conventions, checklist de PR).
> Claude Code lit ce fichier + les agents pertinents à chaque session.

---

## 🎯 Vision produit

**MyTradingCoach** — SaaS freemium de journal de trading intelligent pour traders particuliers (crypto, forex, actions). L'IA analyse émotions et comportements pour aider les traders à progresser.

**Plans** — 2 paliers (PROMPT-169) : FREE (0€, trades illimités, IA mutualisée), PREMIUM (49€/mois · 490€/an, IA personnelle). Essai 30 j, mensuel uniquement (carte requise).
➡️ **Source de vérité plans / prix / features / gating / coût IA : `.claude/agents/plans.md`.** Ne pas dupliquer ni redéfinir les règles de plan ici.

---

## 🏗️ Monorepo

```
.claude/agents/     ← agents spécialisés (lire le pertinent avant de coder)
apps/
├── app-mytradingcoach/     ← Angular 22 (port 4200)
├── admin-mytradingcoach/   ← Angular 22 (back-office, accès ADMIN)
├── api-mytradingcoach/     ← NestJS 11 (port 3000)
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

## 🚦 Workflow obligatoire

### Avant de coder
1. Lire l'agent pertinent dans `.claude/agents/`
2. Lire `admin-mytradingcoach.html` avant tout travail sur l'app admin
3. Lire la maquette dédiée (`maquette-*.html`) si elle existe pour la vue concernée
4. Toute tâche touchant prix / features gated / accès par plan → lire `.claude/agents/plans.md` (cohérence obligatoire aux 4 points : landing, front, guard, cron).

### Pendant
4. Builder après chaque partie — zéro erreur avant de continuer
5. Ne jamais `npm` / `npx` → toujours `pnpm` / `pnpm dlx`

### Après
6. Commit atomique : `feat(scope):` / `fix(scope):` / `perf(scope):`
7. Mettre à jour l'agent concerné dans `.claude/agents/` dès qu'une feature ou un correctif change le comportement/les règles : schéma & migrations → `prisma.md` · DTO/back → `nestjs.md` · calcul P&L / instruments → `instruments.md` · plans/prix/gating/coût IA → `plans.md` · front → `angular.md` · landing → `astro.md` · déploiement → `deploy.md` · design → `design.md` · sécurité → `security.md` · tests → `tests.md`. Un agent périmé est pire que pas d'agent.

---

## 🌐 URLs

```
Production
├── www.mytradingcoach.app       ← Landing (VPS/Nginx derrière Traefik ; l'apex redirige en 301 vers www)
├── app.mytradingcoach.app       ← App Angular (VPS/Nginx derrière Traefik)
└── api.mytradingcoach.app       ← NestJS (VPS OVH Docker)

Dev
├── dev.app.mytradingcoach.app   ← App Angular dev (VPS/Nginx derrière Traefik)
└── dev.api.mytradingcoach.app   ← NestJS dev (VPS OVH port 3001)
```

---

## ❌ Pièges globaux

- `*ngIf` / `*ngFor` → `@if` / `@for`
- `npm` / `npx` → `pnpm` / `pnpm dlx`
- `console.log` NestJS → Logger NestJS
- Prisma dans controllers → passer par les services
- Trial 7/14 jours → **30 jours** (mensuel uniquement ; annuel facturé direct)
- Quota FREE 30 trades/mois → **illimité** · Historique FREE → illimité
- Palier STARTER **supprimé** (PROMPT-169) : ne subsiste que FREE + PREMIUM
- Prix Premium = **49 €** · 490 €/an · valeurs en dur → `pricing.const.ts`
- CSS inline dans `.ts` → toujours dans `.css`
- `@nestjs/bull` → `@nestjs/bullmq`
- Compte démo (`isDemo`) : nouvelle mutation → déjà bloquée par `DemoReadOnlyGuard` (rien à faire) ; nouvelle métrique/agrégat admin ou cron/email ciblant des users → **exclure `isDemo: false`** ; nouvelle feature avec données → vérifier l'affichage démo + enrichir le seed

---

*MyTradingCoach — Juin 2026*
