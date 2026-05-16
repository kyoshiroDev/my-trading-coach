# MyTradingCoach — CLAUDE.md

> Fichier de contexte global. Les règles techniques détaillées sont dans `.claude/agents/`.
> Claude Code lit ce fichier + les agents pertinents à chaque session.

---

## 🎯 Vision produit

**MyTradingCoach** — SaaS freemium de journal de trading intelligent pour traders particuliers (crypto, forex, actions). L'IA analyse émotions et comportements pour aider les traders à progresser.

**Plans :**
- **FREE** : 50 trades/mois, historique illimité, stats de base, journal complet, tracking émotionnel
- **PREMIUM** (39€/mois ou 349€/an) : trades illimités, analytics avancés, IA Insights, Chat Coach, Weekly Debrief automatique, Score trader, Export PDF — essai **7 jours** sans CB

**Règles business absolues :**
- Tout appel Anthropic = PREMIUM uniquement
- `/analytics/summary` accessible FREE (win rate, P&L, streak)
- Historique trades = illimité pour FREE (pas de filtre date)
- Limite FREE = 50 trades/mois uniquement
- Trial = 7 jours (jamais 14)

---

## 🏗️ Monorepo

```
.claude/agents/     ← agents spécialisés (lire le pertinent avant de coder)
apps/
├── app-mytradingcoach/     ← Angular 20 (port 4200)
├── api-mytradingcoach/     ← NestJS 11 (port 3000)
└── landing-mytradingcoach/ ← Astro 5 (port 4321)
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
- Prix $19 → 39€
- CSS inline dans `.ts` → toujours dans `.css`
- `@nestjs/bull` → `@nestjs/bullmq`

---

*MyTradingCoach — Avril 2026*
