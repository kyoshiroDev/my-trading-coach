# MyTradingCoach — CLAUDE.md

> Fichier de contexte projet pour Claude Code.
> Place ce fichier à la racine du monorepo. Claude Code le lit automatiquement à chaque session.
>
> **Fichiers de référence visuelle à placer aussi à la racine :**
> - `app-mytradingcoach.html` → design de l'app Angular (sidebar, dashboard, journal, composants)
> - `landing-mytradingcoach.html` → design de la landing Astro (hero, features, pricing, FAQ)
>
> Ces fichiers sont la source de vérité du design. Reproduire pixel pour pixel.

---

## 🤖 Workflow IA — Règles obligatoires

> Ces règles s'appliquent à CHAQUE session Claude Code sans exception.

### Avant de modifier un fichier
1. **Lire le fichier en entier** avant toute modification — ne jamais écraser sans avoir lu l'existant
2. **Lire `app-mytradingcoach.html`** comme référence visuelle avant tout travail sur Angular
3. **Lire `landing-mytradingcoach.html`** avant tout travail sur Astro

### Pendant le développement
4. **Builder après chaque partie** : `pnpm nx build <app>` — si erreur → corriger avant de continuer
5. **Ne jamais mettre de CSS inline dans les fichiers `.ts`** — toujours dans le `.css` du composant
6. **Toujours utiliser les pipes Angular** pour :
    - Valeurs PnL → `pnl-color.pipe.ts` (jamais `[style.color]` inline)
    - Émotions → `emotion-emoji.pipe.ts`
    - Valeurs numériques → toujours `font-family: var(--font-mono)`
7. **Vérifier les sélecteurs** : tous les composants Angular utilisent le préfixe `mtc-`
8. **`@if` / `@for` obligatoires** — jamais `*ngIf` / `*ngFor` (dépréciés Angular 17+)

### Après chaque modification
9. **Vérifier le build** sans erreur TypeScript ni lint
10. **Commit atomique** par fonctionnalité avec message conventionnel :
    - `feat(scope): description`
    - `fix(scope): description`
    - `fix(responsive): description`

### Pièges critiques à éviter
- ❌ CSS inline dans `.ts` → ✅ toujours dans `.css`
- ❌ `*ngIf` / `*ngFor` → ✅ `@if` / `@for`
- ❌ `npm` / `npx` → ✅ `pnpm` / `pnpm dlx`
- ❌ `console.log` en NestJS → ✅ Logger NestJS
- ❌ Prisma dans les controllers → ✅ passer par les services
- ❌ 14 jours de trial → ✅ 7 jours
- ❌ Filtre 30 jours sur historique FREE → ✅ historique illimité
- ❌ `PremiumGuard` sur la route `/analytics` → ✅ guard dans le composant uniquement

---

## 🎯 Vision produit

**MyTradingCoach** est un SaaS freemium de journal de trading intelligent pour traders particuliers (crypto, forex, actions). L'app analyse les émotions et comportements via IA pour aider les traders à progresser.

**Plans :**
- FREE : 50 trades/mois, historique illimité, stats de base, journal complet, tracking émotionnel
- PREMIUM (39€/mois ou 349€/an) : trades illimités, analytics avancés, IA Insights, Chat coach IA, Weekly Debrief automatique, Score trader, Export PDF — essai **7 jours** sans CB

**Règles plans :**
- Tout ce qui appelle l'API Anthropic = PREMIUM uniquement
- La route `/analytics` est accessible à tous — le contenu PREMIUM est verrouillé dans le composant
- L'historique des trades est illimité pour FREE (pas de filtre date)
- La limite FREE est uniquement : 50 trades/mois

---

## 🏗️ Architecture du monorepo

```
mytradingcoach/
├── apps/
│   ├── app-mytradingcoach/        ← Angular 20 — app web (port 4200)
│   ├── api-mytradingcoach/        ← NestJS 11 — backend REST (port 3000)
│   └── landing-mytradingcoach/    ← Astro 5 — landing SEO (port 4321)
├── libs/
│   ├── domain/                    ← Entités pures, zéro dépendance framework
│   ├── application/               ← Use-cases, ports
│   └── shared/                    ← DTOs, enums partagés
├── prisma/schema.prisma
├── app-mytradingcoach.html        ← Référence design app ← LIRE AVANT TOUT TRAVAIL ANGULAR
├── landing-mytradingcoach.html    ← Référence design landing ← LIRE AVANT TOUT TRAVAIL ASTRO
└── CLAUDE.md
```

**Règle absolue :** Ne jamais importer `libs/domain` depuis Angular, NestJS ou Astro.

---

## 🧱 Stack technique

### Angular (`app-mytradingcoach`) — Angular 20 (v20.2+)
- **Zoneless** : `provideZonelessChangeDetection()` + `provideBrowserGlobalErrorListeners()` dans `app.config.ts`
- **Signals stable** : `signal()`, `computed()`, `effect()`, `linkedSignal()`, `toSignal()`
- **`resource()` / `httpResource()`** (experimental) — pour les appels HTTP liés à des signals, remplace `.subscribe()`
- **Standalone Components** exclusivement — pas de NgModules
- **`@if` / `@for` / `@switch`** dans les templates — `*ngIf`, `*ngFor` sont **dépréciés**
- **`@defer`** pour le lazy loading des composants lourds
- **`DestroyRef`** à la place de `ngOnDestroy`
- **`inject()`** plutôt que constructeur
- Prefix composants : `mtc-` — TypeScript 5.8+, Node.js 20.11.1+
- Icônes : `lucide-angular` exclusivement
- **Tests : Vitest** (pas Jest) — `pnpm nx test app-mytradingcoach`

### NestJS (`api-mytradingcoach`) — NestJS 11 (v11.1+)
- Architecture modulaire par domaine
- **Prisma 7** (v7.3+) — Query Compiler TypeScript pur, sans Rust
- **PostgreSQL 17** (`postgres:17-alpine`)
- **Argon2** pour les mots de passe (pas Bcrypt)
- **JWT** : Passport (`@nestjs/passport`, `passport-jwt`) — access_token 15min, refresh_token 7j httpOnly cookie
- **`@nestjs/bullmq`** pour les queues (pas `@nestjs/bull`, déprécié)
- **`@nestjs/schedule`** pour le cron debrief
- **Logger JSON** : `app.useLogger(new ConsoleLogger({ json: true }))` en production
- **Helmet** : `app.use(helmet())` dans `main.ts`
- **Rate limiting** : `@nestjs/throttler` v6+ — max 20 req/min sur routes IA
- **Tests : Vitest** (pas Jest) — `pnpm nx test api-mytradingcoach`

### Astro (`landing-mytradingcoach`) — Astro 5 (v5.18+) + Tailwind 4
- `output: 'static'` — HTML pur, zéro JS client par défaut
- **Content Layer API** pour le blog (Markdown dans `src/content/blog/`)
- `@astrojs/sitemap` v3.7.2 + `tailwindcss` v4.2.2 + `@tailwindcss/vite`
- Déployée sur Vercel (gratuit, CDN mondial)
- **package.json landing** :
  ```json
  {
    "dependencies": {
      "@astrojs/sitemap": "^3.7.2",
      "astro": "^6.1.1",
      "tailwindcss": "^4.2.2"
    },
    "devDependencies": {
      "@astrojs/check": "^0.9.4",
      "@tailwindcss/vite": "^4.2.2",
      "typescript": "^5.8.3"
    }
  }
  ```

### IA
- Anthropic SDK — modèle `claude-sonnet-4-6` (jamais Opus)
- **Prompt caching obligatoire** sur le contexte utilisateur
- **Batch API** pour les weekly debriefs (50% de réduction)

---

## 🗄️ Schéma Prisma

```prisma
generator client {
  provider = "prisma-client-js"
  previewFeatures = ["queryCompiler", "driverAdapters"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String          @id @default(cuid())
  email        String          @unique
  password     String
  name         String?
  plan         Plan            @default(FREE)
  trialEndsAt  DateTime?
  trialUsed    Boolean         @default(false)
  trades       Trade[]
  debriefs     WeeklyDebrief[]
  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt
}

model Trade {
  id         String         @id @default(cuid())
  userId     String
  user       User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  asset      String
  side       TradeSide
  entry      Float
  exit       Float?
  stopLoss   Float?
  takeProfit Float?
  pnl        Float?
  riskReward Float?
  emotion    EmotionState
  setup      SetupType
  session    TradingSession
  timeframe  String
  notes      String?
  tags       String[]
  tradedAt   DateTime       @default(now())
  createdAt  DateTime       @default(now())

  @@index([userId, tradedAt])
  @@index([userId, emotion])
  @@index([userId, setup])
}

model WeeklyDebrief {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  weekNumber  Int
  year        Int
  startDate   DateTime
  endDate     DateTime
  aiSummary   String
  insights    Json
  objectives  Json
  stats       Json
  generatedAt DateTime @default(now())

  @@unique([userId, weekNumber, year])
  @@index([userId, year, weekNumber])
}

enum Plan            { FREE PREMIUM }
enum TradeSide       { LONG SHORT }
enum EmotionState    { CONFIDENT STRESSED REVENGE FEAR FOCUSED NEUTRAL }
enum SetupType       { BREAKOUT PULLBACK RANGE REVERSAL SCALPING NEWS }
enum TradingSession  { LONDON NEW_YORK ASIAN PRE_MARKET OVERLAP }
```

Toujours `pnpm dlx prisma migrate dev --name <description>` après chaque modification du schéma.

---

## 📁 Structure frontend (`app-mytradingcoach`)

```
src/app/
├── core/
│   ├── auth/          auth.service.ts · auth.guard.ts · auth.interceptor.ts
│   ├── api/           trades.api.ts · analytics.api.ts · debrief.api.ts
│   └── stores/        trades.store.ts · user.store.ts
├── features/
│   ├── dashboard/     dashboard.ts
│   ├── journal/       journal.ts · trade-row.ts · trade-form.ts
│   ├── analytics/     analytics.ts · heatmap.ts
│   ├── ai-insights/   ai-insights.ts · insight-card.ts
│   ├── weekly-debrief/ debrief.ts · debrief-objectives.ts · debrief-emotions.ts
│   └── scoring/       scoring.ts
├── shared/
│   ├── components/    sidebar/ · topbar/ · stat-card/ · badge/
│   └── pipes/         pnl-color.pipe.ts · emotion-emoji.pipe.ts
├── app.component.ts
├── app.config.ts      ← provideZonelessChangeDetection(), provideRouter(), provideHttpClient()
└── app.routes.ts
```

---

## 📁 Structure backend (`api-mytradingcoach`)

```
src/
├── modules/
│   ├── auth/      auth.module · auth.controller · auth.service · jwt.strategy · dto/
│   ├── trades/    trades.module · trades.controller · trades.service · dto/
│   ├── analytics/ analytics.module · analytics.controller · analytics.service
│   ├── ai/        ai.module · ai.controller · ai.service · prompts/
│   ├── debrief/   debrief.module · debrief.controller · debrief.service · debrief.cron
│   └── users/     users.module · users.service
├── common/
│   ├── guards/    jwt-auth.guard · premium.guard
│   ├── interceptors/ response.interceptor (wrapper { data, meta })
│   ├── decorators/   current-user · public
│   └── filters/   http-exception.filter
├── prisma/        prisma.module · prisma.service
├── app.module.ts
└── main.ts
```

---

## 🔌 API REST

```
POST   /api/auth/register          { email, password, name } → { access_token, user }
POST   /api/auth/login             { email, password }        → { access_token, user }
POST   /api/auth/refresh                                      → { access_token }
POST   /api/auth/start-trial                                  → user (active trial 7j)

GET    /api/trades                 ?page&limit&side&setup&emotion&dateFrom&dateTo
POST   /api/trades                 CreateTradeDto             → Trade
GET    /api/trades/:id                                        → Trade
PATCH  /api/trades/:id             UpdateTradeDto             → Trade
DELETE /api/trades/:id                                        → void

GET    /api/analytics/summary      FREE+PREMIUM → { winRate, totalPnl, totalTrades, maxDrawdown, streak }
GET    /api/analytics/by-setup     PREMIUM → [{ setup, winRate, avgRR, count }]
GET    /api/analytics/by-emotion   PREMIUM → [{ emotion, winRate, avgRR, count }]
GET    /api/analytics/by-hour      PREMIUM → [{ hour, winRate, count }]
GET    /api/analytics/equity-curve PREMIUM → [{ date, cumulativePnl }]
GET    /api/analytics/top-assets   PREMIUM → [{ asset, winRate, pnl, count }]

POST   /api/ai/insights            PREMIUM → { insights: Insight[] }
POST   /api/ai/chat                PREMIUM { message, history } → { response: string }

GET    /api/debrief/current        PREMIUM → WeeklyDebrief
GET    /api/debrief/:year/:week    PREMIUM → WeeklyDebrief
GET    /api/debrief/history        PREMIUM → WeeklyDebrief[]
POST   /api/debrief/generate       PREMIUM → WeeklyDebrief

GET    /api/health                           → { status: 'ok' }
POST   /api/test/upgrade-user      NODE_ENV=test uniquement
```

> **Note :** `/api/analytics/summary` est accessible FREE pour afficher
> les stats basiques (win rate, P&L, streak) sur la page Analytics.
> Les autres endpoints analytics sont PREMIUM.

---

## 🤖 Logique IA

### Appel avec prompt caching (obligatoire)
```typescript
const response = await this.anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: [{
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' }
    }],
    messages: [{
        role: 'user',
        content: [
            { type: 'text', text: userContext, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: userRequest }
        ]
    }]
});
```

### Format JSON du Weekly Debrief
```json
{
  "summary": "2-3 phrases, ton coach bienveillant mais direct",
  "strengths": [{ "badge": "Force|Très bien", "text": "string" }],
  "weaknesses": [{ "badge": "Critique|Attention", "text": "string" }],
  "emotionInsight": "corrélation émotion → performance",
  "objectives": [{ "title": "string", "reason": "string" }]
}
```

### Cron + BullMQ
```typescript
@Cron('0 23 * * 0')  // Dimanche 23h00
async scheduledDebriefs() {
    const users = await this.usersService.findActivePremium();
    await Promise.all(users.map(u =>
        this.debriefQueue.add('generate', { userId: u.id }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true,
        })
    ));
}
```

### Quota IA (anti-abus)
```typescript
async checkAiQuota(userId: string) {
    const key = `ai:calls:${userId}:${new Date().toISOString().slice(0,7)}`;
    const count = await this.redis.incr(key);
    await this.redis.expire(key, 60 * 60 * 24 * 31);
    if (count > 100) throw new HttpException('Quota IA atteint', 429);
}
```

### PremiumGuard — logique trial
Autoriser si `user.plan === 'PREMIUM'` OU `user.trialEndsAt && new Date() < user.trialEndsAt`.
Le trial dure **7 jours** (pas 14).
Sinon → 403 `{ code: 'PREMIUM_REQUIRED', trialAvailable: !user.trialUsed }`.

### Règles FREE plan
- 50 trades/mois max → vérifier avant `POST /api/trades`
- **Historique illimité** — pas de filtre date sur `GET /api/trades`
- `/api/analytics/summary` accessible FREE (win rate global, P&L, streak)
- Tout le reste analytics + IA + debrief → PREMIUM uniquement

---

## 🎨 Design — Référence visuelle

> **RÈGLE CRITIQUE : Lire `app-mytradingcoach.html` AVANT tout travail sur Angular.**
> **RÈGLE CRITIQUE : Lire `landing-mytradingcoach.html` AVANT tout travail sur Astro.**
> Ne pas inventer de couleurs, polices ou composants. Reproduire exactement.

**Polices :**
- Display/Titres : `Syne` (700/800)
- Corps : `DM Sans` (400/500)
- Valeurs numériques : `DM Mono` (400/500) — **obligatoire pour tous les chiffres PnL, %, prix**

**Tokens CSS :**
```css
--bg: #080c14          --bg-2: #0d1420       --bg-3: #111b2e
--bg-card: #0f1824     --border: rgba(99,155,255,.1)
--blue: #3b82f6        --blue-bright: #60a5fa
--green: #10b981       --green-dim: rgba(16,185,129,.12)
--red: #ef4444         --red-dim: rgba(239,68,68,.12)
--yellow: #f59e0b      --text: #e2eaf5
--text-2: #8fa3bf      --text-3: #4a6080
```

**Règles absolues :**
1. Dark mode uniquement — jamais de fond blanc
2. Vert (`#10b981`) uniquement pour les gains — jamais décoratif
3. Rouge (`#ef4444`) uniquement pour les pertes — jamais décoratif
4. Toutes les valeurs numériques en `font-mono`
5. Icônes : `lucide-angular` exclusivement
6. Header/topbar : **77px** de hauteur

---

## ✅ Conventions de code

| Élément | Convention |
|---|---|
| Fichiers Angular | kebab-case : `trade-form.ts` |
| Classes Angular | PascalCase : `TradeForm` |
| Signals | camelCase + `$` : `trades$`, `winRate$` |
| DTOs NestJS | PascalCase + Dto : `CreateTradeDto` |
| Enums | PascalCase : `TradeSide.LONG` |

**Angular 20 — règles obligatoires :**
- `provideZonelessChangeDetection()` dans `app.config.ts`
- `@if` / `@for` dans les templates — jamais `*ngIf` / `*ngFor`
- `inject()` plutôt que constructeur
- `OnPush` sur les composants qui n'utilisent pas encore les signals
- CSS dans `.css` uniquement — jamais inline dans `.ts`

**NestJS — règles obligatoires :**
- `@UseGuards(JwtAuthGuard)` sur toutes les routes protégées
- `@UseGuards(PremiumGuard)` sur routes IA et analytics avancés
- `/api/analytics/summary` : PAS de PremiumGuard (accessible FREE)
- `ValidationPipe` global : `whitelist: true, forbidNonWhitelisted: true`
- Ne jamais appeler Prisma dans les controllers
- Ne jamais `console.log` — utiliser le logger NestJS

---

## 🧪 Tests

### Framework
- **Angular** : Vitest (pas Jest)
- **NestJS** : Vitest (pas Jest)
- **E2E** : Playwright

### Commandes
```bash
pnpm nx test app-mytradingcoach        # Vitest Angular
pnpm nx test api-mytradingcoach        # Vitest NestJS
pnpm nx e2e app-mytradingcoach-e2e     # Playwright E2E
```

### Tests critiques à maintenir (ne jamais casser)
```
NestJS (Vitest)
├── auth.service.spec.ts     → register, login, trial 7j, refresh token
├── trades.service.spec.ts   → CRUD, limite 50/mois FREE, historique illimité
├── analytics.service.spec.ts → summary accessible FREE, avancés PREMIUM
└── premium.guard.spec.ts    → FREE bloqué, PREMIUM autorisé, trial valide

Angular (Vitest)
├── user.store.spec.ts       → isPremium(), isFreePlan()
├── auth.guard.spec.ts       → redirect si non connecté
└── pnl-color.pipe.spec.ts   → vert si positif, rouge si négatif

E2E (Playwright)
├── auth.spec.ts             → register → login → dashboard
├── journal.spec.ts          → ajouter trade, voir dans la liste
├── analytics-free.spec.ts   → FREE voit stats + blocs verrouillés
└── analytics-premium.spec.ts → PREMIUM voit tout
```

### Config Vitest NestJS
```typescript
// vitest.config.ts (api)
import { defineConfig } from 'vitest/config';
export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.spec.ts'],
        coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
    },
});
```

### Config Vitest Angular
```typescript
// vitest.config.ts (app)
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

## 🔐 Sécurité

```
DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET
ANTHROPIC_API_KEY, REDIS_PASSWORD, POSTGRES_PASSWORD
```
Ne jamais hardcoder. Ne jamais commiter `.env.production` ni `.env.dev`.

---

## 🚀 Commandes essentielles

> **RÈGLE ABSOLUE : Ce projet utilise PNPM exclusivement.**
> - Jamais `npm install` → utiliser `pnpm install`
> - Jamais `npm run` → utiliser `pnpm run` ou `pnpm nx`
> - Jamais `npx` → utiliser `pnpm dlx`
> - Le lockfile est `pnpm-lock.yaml` — ne jamais commiter `package-lock.json`

```bash
# Dev
pnpm nx serve app-mytradingcoach       # Angular  → localhost:4200
pnpm nx serve api-mytradingcoach       # NestJS   → localhost:3000
pnpm nx dev   landing-mytradingcoach   # Astro    → localhost:4321

# Prisma
pnpm dlx prisma migrate dev --name <desc>
pnpm dlx prisma studio
pnpm dlx prisma generate

# Build
pnpm nx build app-mytradingcoach --configuration=production
pnpm nx build api-mytradingcoach --configuration=production
pnpm nx build landing-mytradingcoach

# Tests
pnpm nx test app-mytradingcoach        # Vitest Angular
pnpm nx test api-mytradingcoach        # Vitest NestJS
pnpm nx e2e  app-mytradingcoach-e2e    # Playwright E2E
```

---

## 🌐 URLs

```
Production
├── mytradingcoach.app              ← Landing Astro (Vercel)
├── app.mytradingcoach.app          ← App Angular (Vercel)
└── api.mytradingcoach.app          ← NestJS (VPS OVH, Docker)

Dev
├── dev.mytradingcoach.app          ← Landing dev (optionnel)
├── dev.app.mytradingcoach.app      ← App Angular dev (Vercel)
└── dev.api.mytradingcoach.app      ← NestJS dev (VPS OVH, port 3001)
```

```typescript
// environment.production.ts
export const environment = {
    production: true,
    apiUrl: 'https://api.mytradingcoach.app',
    appName: 'MyTradingCoach',
    appUrl: 'https://app.mytradingcoach.app',
    landingUrl: 'https://mytradingcoach.app',
};

// environment.dev.ts
export const environment = {
    production: false,
    apiUrl: 'https://dev.api.mytradingcoach.app',
    appName: 'MyTradingCoach [DEV]',
    appUrl: 'https://dev.app.mytradingcoach.app',
    landingUrl: 'https://mytradingcoach.app',
};
```

---

## 🐳 Docker

### `docker-compose.yml` (production)
```yaml
services:
  api:
    build: { context: ., dockerfile: apps/api-mytradingcoach/Dockerfile }
    container_name: mtc_api
    env_file: .env.production
    ports: ["127.0.0.1:3000:3000"]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
    restart: unless-stopped
    networks: [mtc_network]

  postgres:
    image: postgres:17-alpine
    container_name: mtc_postgres
    env_file: .env.production
    volumes: [postgres_data:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mtc_user -d mytradingcoach"]
      interval: 10s; timeout: 5s; retries: 5
    restart: unless-stopped
    networks: [mtc_network]

  redis:
    image: redis:7.4-alpine
    container_name: mtc_redis
    command: redis-server --maxmemory 128mb --maxmemory-policy allkeys-lru --requirepass ${REDIS_PASSWORD}
    volumes: [redis_data:/data]
    restart: unless-stopped
    networks: [mtc_network]

volumes:
  postgres_data:
  redis_data:

networks:
  mtc_network:
    driver: bridge
```

---

## 📈 Scalabilité

### Cache Redis analytics
```typescript
async getSummary(userId: string) {
    const key = `analytics:summary:${userId}`;
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached);
    const data = await this.computeSummary(userId);
    await this.redis.setex(key, 300, JSON.stringify(data));
    return data;
}
async onTradeCreated(userId: string) {
    await this.redis.del(`analytics:summary:${userId}`);
}
```

### Pagination curseur
```typescript
const trades = await prisma.trade.findMany({
    take: limit,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    where: { userId },
    orderBy: { tradedAt: 'desc' },
});
```

---

## 🔗 Ressources

- [Angular 20](https://blog.angular.dev/announcing-angular-v20-b5c9c06cf301)
- [Angular Zoneless](https://angular.dev/guide/zoneless)
- [NestJS BullMQ](https://docs.nestjs.com/techniques/queues)
- [Prisma 7](https://www.prisma.io/blog/prisma-orm-7)
- [Astro 5 Content Layer](https://docs.astro.build/en/guides/content-collections/)
- [Anthropic Prompt Caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
- [Anthropic Batch API](https://docs.anthropic.com/en/docs/build-with-claude/message-batches)
- [Vitest](https://vitest.dev/)
- [Playwright](https://playwright.dev/)

---

*MyTradingCoach — Avril 2026*