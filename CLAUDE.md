# MyTradingCoach — CLAUDE.md

> Fichier de contexte projet pour Claude Code.
> Place ce fichier à la racine du monorepo. Claude Code le lit automatiquement à chaque session.
>
> **Fichiers de référence visuelle à placer aussi à la racine :**
> - `app-mytradingcoach.html` → design de l'app Angular (sidebar, dashboard, journal, composants)
> - `landing-mytradingcoach.html` → design de la landing Astro (hero, features, pricing, FAQ)
    > Ces fichiers sont la source de vérité du design. Reproduire pixel pour pixel.

---

## 🎯 Vision produit

**MyTradingCoach** est un SaaS freemium de journal de trading intelligent pour traders particuliers (crypto, forex, actions). L'app analyse les émotions et comportements via IA pour aider les traders à progresser.

**Plans :**
- FREE : 50 trades/mois, historique 30 jours, stats de base
- PREMIUM ($19/mois ou $190/an) : trades illimités, analytics avancés, IA Insights & Chat, Weekly Debrief automatique, Score trader, Export PDF — essai 14 jours sans CB

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
├── app-mytradingcoach.html        ← Référence design app
├── landing-mytradingcoach.html    ← Référence design landing
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

### Astro (`landing-mytradingcoach`) — Astro 5 (v5.18+)
- `output: 'static'` — HTML pur, zéro JS client par défaut
- **Content Layer API** pour le blog (Markdown dans `src/content/blog/`)
- `@astrojs/sitemap` + `@astrojs/tailwind`
- Déployée sur Vercel (gratuit, CDN mondial)

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

Toujours `npx prisma migrate dev --name <description>` après chaque modification du schéma.

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
POST   /api/auth/start-trial                                  → user (active trial 14j)

GET    /api/trades                 ?page&limit&side&setup&emotion&dateFrom&dateTo
POST   /api/trades                 CreateTradeDto             → Trade
GET    /api/trades/:id                                        → Trade
PATCH  /api/trades/:id             UpdateTradeDto             → Trade
DELETE /api/trades/:id                                        → void

GET    /api/analytics/summary      PREMIUM → { winRate, totalPnl, totalTrades, maxDrawdown, streak }
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
// debrief.processor.ts
@Processor('debrief')
export class DebriefProcessor extends WorkerHost {
  async process(job: Job<{ userId: string }>) {
    await this.debriefService.generateForUser(job.data.userId);
  }
}

// debrief.cron.ts
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
Sinon → 403 `{ code: 'PREMIUM_REQUIRED', trialAvailable: !user.trialUsed }`.

### Limite FREE plan
- 50 trades/mois max → vérifier avant `POST /api/trades`
- Historique limité 30 jours → `where: { tradedAt: { gte: subDays(new Date(), 30) } }` sur `GET /api/trades`

---

## 🎨 Design — Référence visuelle

> **Ne pas inventer de couleurs, polices ou composants.** Reproduire exactement les fichiers HTML de référence.

**App Angular** → `app-mytradingcoach.html` (sidebar, dashboard, journal, modals)
**Landing Astro** → `landing-mytradingcoach.html` (hero, features, pricing, FAQ, footer)

**Polices** (identiques dans les deux fichiers) :
- Display/Titres : `Syne` (700/800)
- Corps : `DM Sans` ou `Inter` (400/500)
- Valeurs numériques : `DM Mono` (400/500) — **obligatoire pour tous les chiffres PnL, %, prix**

**Règles absolues :**
1. Dark mode uniquement — jamais de fond blanc
2. Vert (`#10b981`) uniquement pour les gains — jamais décoratif
3. Rouge (`#ef4444`) uniquement pour les pertes — jamais décoratif
4. Toutes les valeurs numériques en `font-mono`
5. Icônes : `lucide-angular` exclusivement

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

**NestJS — règles obligatoires :**
- `@UseGuards(JwtAuthGuard)` sur toutes les routes protégées
- `@UseGuards(PremiumGuard)` sur toutes les routes IA et analytics
- `ValidationPipe` global : `whitelist: true, forbidNonWhitelisted: true`
- Ne jamais appeler Prisma dans les controllers — passer par les services
- Ne jamais `console.log` — utiliser le logger NestJS

---

## 🔐 Sécurité

```
DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET
ANTHROPIC_API_KEY, REDIS_PASSWORD, POSTGRES_PASSWORD
```
Ne jamais hardcoder. Ne jamais commiter `.env.production`.

---

## 🚀 Commandes essentielles

> **RÈGLE ABSOLUE : Ce projet utilise PNPM exclusivement.**
> - Jamais `npm install` → utiliser `pnpm install`
> - Jamais `npm run` → utiliser `pnpm run` ou `pnpm nx`
> - Jamais `npx` → utiliser `pnpm dlx`
> - Le lockfile est `pnpm-lock.yaml` — ne jamais commiter `package-lock.json`

```bash
pnpm nx serve app-mytradingcoach       # Angular  → localhost:4200
pnpm nx serve api-mytradingcoach       # NestJS   → localhost:3000
pnpm nx dev   landing-mytradingcoach   # Astro    → localhost:4321

pnpm dlx prisma migrate dev --name <desc>
pnpm dlx prisma studio
pnpm dlx prisma generate

pnpm nx build app-mytradingcoach --configuration=production
pnpm nx build api-mytradingcoach --configuration=production
pnpm nx build landing-mytradingcoach

pnpm nx test app-mytradingcoach
pnpm nx test api-mytradingcoach
pnpm nx e2e  app-mytradingcoach-e2e
```

---

## 📋 Ordre d'implémentation

### Phase 1 — Fondations
1. `npx create-nx-workspace@latest mytradingcoach --preset=empty`
2. Créer les 3 apps Nx (Angular, NestJS, Astro)
3. Prisma + PostgreSQL + migration initiale
4. Module Auth complet (register, login, JWT, trial)
5. `JwtAuthGuard` + `PremiumGuard`

### Phase 2 — Core trading
6. Module Trades : CRUD + filtres + pagination curseur + limite FREE
7. Composants Angular : Journal, Trade Form modal, Dashboard stats
8. Signal stores

### Phase 3 — Analytics
9. Module Analytics : tous les endpoints
10. Cache Redis sur `GET /analytics/summary`
11. Composants : heatmap, equity curve Canvas, top actifs

### Phase 4 — IA
12. Module AI : Anthropic SDK + prompt caching + quota
13. `/ai/insights` + `/ai/chat`
14. Composants AI Insights + chat

### Phase 5 — Weekly Debrief
15. Module Debrief : service + BullMQ + prompts JSON
16. Composant Weekly Debrief
17. Export PDF (Puppeteer)

### Phase 6 — Finitions
18. Scoring trader (5 axes)
19. Pages login/register Angular
20. Guards de routes Angular
21. Tests unitaires critiques

### Phase 7 — Landing
22. Reproduire `landing-mytradingcoach.html` en composants Astro
23. 5 articles blog Markdown (voir noms ci-dessous)
24. Vérifier LCP < 1.2s, CLS < 0.05

### Phase 8 — Docker & déploiement
25. Dockerfile, docker-compose.yml, nginx.conf
26. deploy.sh
27. Certbot wildcard `*.mytradingcoach.app`

---

## 🌐 URLs de production

```
mytradingcoach.app              ← Landing Astro (Vercel)
app.mytradingcoach.app          ← App Angular (VPS OVH)
api.mytradingcoach.app          ← NestJS (Docker interne)
```

```typescript
// environment.production.ts
export const environment = {
  production: true,
  apiUrl: 'https://app.mytradingcoach.app/api',
  appName: 'MyTradingCoach',
  appUrl: 'https://app.mytradingcoach.app',
  landingUrl: 'https://mytradingcoach.app',
};
```

```bash
# .env.production
FRONTEND_URL=https://app.mytradingcoach.app
LANDING_URL=https://mytradingcoach.app
CORS_ORIGINS=https://app.mytradingcoach.app,https://mytradingcoach.app
```

---

## 🐳 Docker

### `docker-compose.yml` (production, sans `version:`)

```yaml
services:
  nginx:
    image: nginx:1.27-alpine
    container_name: mtc_nginx
    ports: ["80:80", "443:443"]
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/letsencrypt:ro
      - ./apps/app-mytradingcoach/dist/browser:/usr/share/nginx/html:ro
    depends_on: [api]
    restart: unless-stopped
    networks: [mtc_network]

  api:
    build: { context: ., dockerfile: apps/api-mytradingcoach/Dockerfile }
    container_name: mtc_api
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://mtc_user:${POSTGRES_PASSWORD}@postgres:5432/mytradingcoach
      - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
      - JWT_SECRET=${JWT_SECRET}
      - JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - PORT=3000
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
    restart: unless-stopped
    networks: [mtc_network]

  postgres:
    image: postgres:17-alpine
    container_name: mtc_postgres
    environment:
      POSTGRES_DB: mytradingcoach
      POSTGRES_USER: mtc_user
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes: [postgres_data:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mtc_user -d mytradingcoach"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks: [mtc_network]

  redis:
    image: redis:7.4-alpine
    container_name: mtc_redis
    command: redis-server --maxmemory 128mb --maxmemory-policy allkeys-lru --requirepass ${REDIS_PASSWORD}
    volumes: [redis_data:/data]
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
    restart: unless-stopped
    networks: [mtc_network]

volumes:
  postgres_data:
  redis_data:

networks:
  mtc_network:
    driver: bridge
```

### `docker-compose.dev.yml`
```yaml
services:
  postgres:
    image: postgres:17-alpine
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: mytradingcoach_dev
      POSTGRES_USER: mtc_user
      POSTGRES_PASSWORD: devpassword
    volumes: [postgres_dev_data:/var/lib/postgresql/data]
  redis:
    image: redis:7.4-alpine
    ports: ["6379:6379"]
volumes:
  postgres_dev_data:
```

### `apps/api-mytradingcoach/Dockerfile`
```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json nx.json tsconfig*.json ./
RUN npm ci
COPY . .
RUN npx nx build api-mytradingcoach --configuration=production

FROM node:22-alpine AS migrator
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
RUN npx prisma generate

FROM node:22-alpine AS runtime
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001
WORKDIR /app
COPY --from=builder --chown=nestjs:nodejs /app/dist/apps/api-mytradingcoach ./
COPY --from=migrator --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=migrator --chown=nestjs:nodejs /app/prisma ./prisma
USER nestjs
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node main.js"]
```

---

## 🌍 Landing — Articles blog SEO

Créer dans `src/content/blog/` avec frontmatter `title`, `description`, `publishDate`, `tags`.

| Fichier | Mot-clé cible |
|---|---|
| `journal-trading-debutant.md` | journal de trading débutant |
| `psychologie-trading.md` | psychologie trading, biais cognitifs |
| `revenge-trading.md` | revenge trading (faible concurrence) |
| `win-rate-trading.md` | win rate trading, calculer win rate |
| `journal-trading-crypto.md` | journal trading crypto 2026 |

CTA en fin de chaque article : `"Essaie MyTradingCoach gratuitement →"` vers `https://app.mytradingcoach.app/register`

---

## ⚠️ Pièges à éviter

1. `*ngIf` / `*ngFor` dépréciés → utiliser `@if` / `@for`
2. Oublier `provideZonelessChangeDetection()` → `zone.js` inclus, bundle inutilement lourd
3. Logique métier dans les controllers NestJS → toujours dans les services
4. Appel Prisma direct dans les controllers → passer par les services
5. Oublier `PremiumGuard` sur les routes IA et analytics
6. URL de l'API hardcodée → utiliser `environment.apiUrl`
7. Pagination offset → utiliser cursor-based (O(1))
8. Ne pas exposer le hash du mot de passe dans les réponses API
9. Oublier `cache_control` sur les appels Anthropic → coûts IA ×10
10. Mettre `version:` dans docker-compose → obsolète Compose v2
11. Utiliser `@nestjs/bull` → utiliser `@nestjs/bullmq`
12. `--legacy-peer-deps` dans les Dockerfiles → signe d'un conflit à résoudre

---

## 📈 Scalabilité — Patterns essentiels

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
// Invalider à chaque nouveau trade
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

---

*MyTradingCoach — Mars 2026*