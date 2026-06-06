# MyTradingCoach — CLAUDE.md

> Fichier de contexte global. Les règles techniques détaillées sont dans `.claude/agents/`.
> Claude Code lit ce fichier + les agents pertinents à chaque session.

---

## 🎯 Vision produit

**MyTradingCoach** — SaaS freemium de journal de trading intelligent pour traders particuliers (crypto, forex, actions). L'IA analyse émotions et comportements pour aider les traders à progresser.

**Plans (source de vérité tarifaire : landing `Pricing.astro` + `core/constants/pricing.const.ts`) :**
- **FREE** — gratuit : 30 trades/mois, historique illimité, journal complet, stats de base, **compagnon de session** (pré-session + session live + débrief de session), **calendrier éco brut** (events + épingles), tracking émotionnel
- **STARTER** — **39 €/mois** ou **349 €/an** (~29 €/mois annualisé, économie 119 €) : tout FREE + trades illimités, analytics avancés, Weekly Debrief automatique, Score trader /100, Export PDF — essai **7 jours** sans CB
- **PREMIUM** — **79 €/mois** ou **699 €/an** (~58 €/mois annualisé, économie 249 €) : tout Starter + IA Insights, Chat Coach IA, Calendrier éco IA, News live filtrées, contexte marché live, Treasury Rates, Recap email 17h30 — essai **7 jours** sans CB

**Règles business absolues :**
- Tout appel Anthropic = PREMIUM uniquement (Starter n'a pas d'IA)
- `/analytics/summary` accessible FREE (win rate, P&L, streak)
- Compagnon de session (pré-session, live, débrief de session) = FREE (hook) ; Weekly Debrief = Starter
- Calendrier éco : affichage + épingles = FREE ; analyse IA (bull/bear) = PREMIUM (guard au niveau méthode)
- Historique trades = illimité pour FREE (pas de filtre date)
- Limite FREE = 30 trades/mois uniquement
- Trial = 7 jours (jamais 14)
- Prix : ne jamais coder une valeur tarifaire en dur → toujours `pricing.const.ts` (front), aligné sur la landing. Prix Stripe réels pilotés par les `STRIPE_*_PRICE_*`.

---

## 🏗️ Monorepo

```
.claude/agents/     ← agents spécialisés (lire le pertinent avant de coder)
apps/
├── app-mytradingcoach/     ← Angular 21 (port 4200)
├── admin-mytradingcoach/   ← Angular 21 (back-office, accès ADMIN)
├── api-mytradingcoach/     ← NestJS 11 (port 3000)
└── landing-mytradingcoach/ ← Astro 6 (port 4321)
prisma/schema.prisma
app-mytradingcoach.html     ← référence design app    ← LIRE AVANT ANGULAR
landing-mytradingcoach.html ← référence design landing ← LIRE AVANT ASTRO
CLAUDE.md
```

---

## 🔄 Règle de synchronisation — OBLIGATOIRE

Après chaque modification Angular → mettre à jour `app-mytradingcoach.html`.

| Composant modifié | Section HTML à mettre à jour |
|---|---|
| `dashboard.component` | `id="view-dashboard"` |
| `journal.component` | `id="view-journal"` |
| `trade-form.component` | modal `id="modal-trade"` |
| `analytics.component` | `id="view-analytics"` |
| `ai-insights.component` | `id="view-ai"` |
| `debrief.component` | `id="view-debrief"` |
| `scoring.component` | `id="view-scoring"` |
| `settings.component` | `id="view-settings"` |
| `sidebar.component` | `aside.sidebar` |
| `topbar.component` | `header.topbar` |

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
2. Lire `app-mytradingcoach.html` avant tout travail Angular
3. Lire `landing-mytradingcoach.html` avant tout travail Astro
4. Lire le fichier cible en entier avant modification

### Pendant
5. Builder après chaque partie — zéro erreur avant de continuer
6. Ne jamais `npm` / `npx` → toujours `pnpm` / `pnpm dlx`

### Après
7. Synchroniser `app-mytradingcoach.html` si composant Angular modifié
8. Commit atomique : `feat(scope):` / `fix(scope):` / `perf(scope):`

---

## 🌐 URLs

```
Production
├── mytradingcoach.app           ← Landing (Vercel)
├── app.mytradingcoach.app       ← App Angular (Vercel)
└── api.mytradingcoach.app       ← NestJS (VPS OVH Docker)

Dev
├── dev.app.mytradingcoach.app   ← App Angular dev (Vercel)
└── dev.api.mytradingcoach.app   ← NestJS dev (VPS OVH port 3001)
```

---

## ❌ Pièges globaux

- `*ngIf` / `*ngFor` → `@if` / `@for`
- `npm` / `npx` → `pnpm` / `pnpm dlx`
- `console.log` NestJS → Logger NestJS
- Prisma dans controllers → passer par les services
- Trial 14 jours → 7 jours
- Historique FREE 30 jours → illimité
- Prix Premium = **79 €** (pas 39 € — 39 € = Starter) · valeurs en dur → `pricing.const.ts`
- CSS inline dans `.ts` → toujours dans `.css`
- `@nestjs/bull` → `@nestjs/bullmq`

---

*MyTradingCoach — Juin 2026*
