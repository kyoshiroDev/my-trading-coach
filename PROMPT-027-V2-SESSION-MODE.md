# PROMPT 027 — V2 : Mode Session (Dashboard Compagnon de Trading)

## Objectif

Transformer le dashboard MTC d'un outil de **review post-session** en un **compagnon de session en temps réel**. Le trader ouvre MTC en même temps que TradingView — avant, pendant et après sa session.

## Référence visuelle

Le fichier `mtc-session-mockup-final.html` à la racine est la référence design complète pour toutes les vues à implémenter. **Lire ce fichier en entier avant de coder.**

---

## Règle de travail — VALIDATION PAR ÉTAPE

Chaque étape se termine par un build propre + tests verts. **Ne pas passer à l'étape suivante sans validation explicite.** À la fin de chaque étape, afficher :

```
✅ ÉTAPE N terminée — build OK, tests OK
👉 Valide pour passer à l'étape N+1 ?
```

---

## Règle design absolue — NE PAS MODIFIER L'EXISTANT

> Cette règle s'applique à **toutes les étapes** sans exception.

- **Zéro modification** sur les composants existants : `dashboard.component.css`, `sidebar.component`, `topbar.component`, `stat-card`, `trade-form`, `journal`, `analytics`, `ai-insights`, `debrief`, `scoring`, `settings`
- **Zéro modification** sur `styles.css`, les variables CSS globales, les tokens de couleur — ils sont la source de vérité, on les **utilise** uniquement
- Tous les nouveaux composants (`session-morning`, `session-live`, etc.) héritent du design system existant via les variables CSS (`var(--bg-card)`, `var(--border)`, `var(--blue)`, etc.)
- Si un nouveau composant ressemble visuellement différent du reste → c'est un bug, pas un choix
- Lire `app-mytradingcoach.html` et `.claude/agents/design.md` avant de créer le moindre fichier `.css`
- Pattern pour les nouvelles cards : copier exactement `.stat-card`, `.card`, `.card-header`, `.card-title` — ne pas réinventer
- Pattern pour les nouveaux boutons : copier exactement `.btn`, `.btn-primary` — ne pas réinventer
- **Le dashboard V1 dans le bloc `@else` est intouchable** — copie exacte, aucune ligne modifiée

---

## Mise en place

```bash
# Lire avant tout
cat CLAUDE.md
cat .claude/agents/angular.md
cat .claude/agents/nestjs.md
cat .claude/agents/prisma.md
cat .claude/agents/design.md
cat .claude/agents/tests.md
cat mtc-session-mockup-final.html   # référence design complète V2

# Créer la branche V2
git checkout -b feat/v2-session-mode
```

---


---

## ÉTAPE 0 — BetaGuard : nouvelles features visibles uniquement pour BETA_TESTER

**Agent : nestjs + angular**

> ⚠️ Cette étape est la **première à implémenter**. Toutes les nouvelles features V2 sont cachées derrière le rôle `BETA_TESTER` (déjà défini dans le schéma Prisma). Les utilisateurs FREE et PREMIUM standard ne voient pas de changement — ils ont leur dashboard V1 intact.

---

### 0.1 Backend — Créer `BetaGuard`

Fichier : `apps/api-mytradingcoach/src/common/guards/beta.guard.ts`

```typescript
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class BetaGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user;
    const hasAccess =
      user.role === 'BETA_TESTER' || user.role === 'ADMIN';
    if (!hasAccess) {
      throw new ForbiddenException({ code: 'BETA_ONLY' });
    }
    return true;
  }
}
```

Exporter depuis `common/guards/index.ts` :

```typescript
export { BetaGuard } from './beta.guard';
```

---

### 0.2 Backend — Endpoint admin pour assigner le rôle BETA_TESTER

Ajouter dans `apps/api-mytradingcoach/src/modules/admin/admin.controller.ts` :

```typescript
@Post('users/:id/beta')
@UseGuards(JwtAuthGuard, AdminGuard)
async assignBetaRole(@Param('id') id: string) {
  return this.usersService.updateRole(id, 'BETA_TESTER');
}

@Delete('users/:id/beta')
@UseGuards(JwtAuthGuard, AdminGuard)
async removeBetaRole(@Param('id') id: string) {
  return this.usersService.updateRole(id, 'USER');
}
```

Ajouter dans `users.service.ts` :

```typescript
async updateRole(userId: string, role: Role): Promise<{ id: string; role: Role }> {
  return this.prisma.user.update({
    where: { id: userId },
    data: { role },
    select: { id: true, role: true, email: true, name: true },
  });
}
```

---

### 0.3 Backend — Mettre à jour le JWT Payload pour inclure le rôle

Vérifier que `role` est bien inclus dans le payload JWT signé. Dans `auth.service.ts`, s'assurer que :

```typescript
const payload: JwtPayload = {
  sub: user.id,
  email: user.email,
  plan: user.plan,
  role: user.role,           // ← s'assurer que c'est bien présent
  trialEndsAt: user.trialEndsAt?.toISOString(),
};
```

Et dans `JwtPayload` interface :

```typescript
interface JwtPayload {
  sub: string;
  email: string;
  plan: Plan;
  role: Role;                // ← ajouter si absent
  trialEndsAt?: string;
}
```

---

### 0.4 Frontend — Ajouter `isBeta` dans `UserStore`

Dans `apps/app-mytradingcoach/src/app/core/stores/user.store.ts` :

```typescript
// Signal computed à ajouter
readonly isBeta = computed(
  () => this.role() === 'BETA_TESTER' || this.role() === 'ADMIN'
);
```

S'assurer que `role` est bien stocké dans le store au login. Vérifier que le modèle `User` côté frontend inclut `role`.

---

### 0.5 Frontend — Dashboard : wrapper conditionnel V1 / V2

Dans `dashboard.component.html`, la structure globale devient :

```html
<!-- DASHBOARD V2 — BETA uniquement -->
@if (userStore.isBeta()) {
  <!-- Greeting + tabs ① ② ③ -->
  <div class="greeting">
    <h1 class="greeting-title">Bonjour, {{ userStore.name() }} 👋</h1>
    <div class="greeting-sub">{{ today | date:'EEEE d MMMM' }}</div>
    <div class="session-tabs">
      <button class="session-tab" ...>① Dashboard actuel</button>
      <button class="session-tab" ...>② Matin — pré-session</button>
      <button class="session-tab" ...>③ Session live</button>
    </div>
  </div>
  <!-- 4 stat cards -->
  <!-- Vues morning / live selon dashboardView() -->
}

<!-- DASHBOARD V1 — tous les autres users -->
@else {
  <!-- Dashboard actuel inchangé — greeting, stat cards, equity curve, trades, etc. -->
  <div class="greeting">
    <h1 class="greeting-title">Bonjour, {{ userStore.name() }} 👋</h1>
  </div>
  <!-- ... tout le dashboard V1 existant ... -->
}
```

> **Important :** le bloc `@else` doit être une copie exacte du dashboard V1 actuel — ne rien modifier dedans.

---

### 0.6 Frontend — Gestion de l'erreur `BETA_ONLY` côté API

Dans les API services V2 (session.api.ts, eco-calendar.api.ts, daily-recap.api.ts), intercepter le 403 `BETA_ONLY` sans afficher d'erreur à l'utilisateur (cas impossible en pratique puisque les tabs sont cachés, mais par sécurité) :

```typescript
// Dans auth.interceptor.ts ou dans chaque api service
catchError(err => {
  if (err.status === 403 && err.error?.code === 'BETA_ONLY') {
    // Silencieux — ne jamais arriver ici si le guard Angular est correct
    return EMPTY;
  }
  throw err;
})
```

---

### 0.7 Tests unitaires `beta.guard.spec.ts`

```typescript
describe('BetaGuard', () => {
  it('autorise BETA_TESTER', () => {
    const ctx = mockContext({ role: 'BETA_TESTER' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('autorise ADMIN', () => {
    const ctx = mockContext({ role: 'ADMIN' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('refuse USER avec code BETA_ONLY', () => {
    const ctx = mockContext({ role: 'USER' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('refuse PREMIUM avec code BETA_ONLY', () => {
    // PREMIUM = plan, pas un rôle — un user PREMIUM reste USER comme rôle
    const ctx = mockContext({ role: 'USER', plan: 'PREMIUM' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
```

### Tests Angular `user.store.spec.ts` — ajouter

```typescript
it('isBeta retourne true pour BETA_TESTER', () => {
  store.setRole('BETA_TESTER');
  expect(store.isBeta()).toBe(true);
});

it('isBeta retourne true pour ADMIN', () => {
  store.setRole('ADMIN');
  expect(store.isBeta()).toBe(true);
});

it('isBeta retourne false pour USER', () => {
  store.setRole('USER');
  expect(store.isBeta()).toBe(false);
});
```

---

### 0.8 Assigner les bêta-testeurs en base

Une fois l'étape 0 déployée sur `dev`, assigner le rôle via l'app admin ou directement en base :

```sql
-- Via psql sur le VPS (remplacer l'email)
UPDATE "User" SET role = 'BETA_TESTER' WHERE email = 'beta.user@example.com';
```

Ou via l'endpoint admin :

```bash
POST /api/admin/users/:id/beta
Authorization: Bearer <admin_token>
```

---


### 0.9 Badge BÊTA — rappel visuel sur les features en cours de test

> Les éléments exclusifs V2 affichent un badge discret "BÊTA" pour rappeler au testeur que la feature est expérimentale. Le badge utilise les variables CSS existantes — aucun nouveau token.

**CSS à ajouter dans `dashboard.component.css`** (nouvelles classes uniquement) :

```css
/* Badge BÊTA — discret, cohérent avec le design system */
.badge-beta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 9px;
  font-family: var(--font-mono);
  font-weight: 700;
  letter-spacing: .6px;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 4px;
  background: rgba(139, 92, 246, .1);
  color: #a78bfa;
  border: 1px solid rgba(139, 92, 246, .22);
  vertical-align: middle;
  flex-shrink: 0;
}

/* Variante pill sur les titres de section */
.badge-beta-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-family: var(--font-mono);
  font-weight: 700;
  padding: 3px 9px;
  border-radius: 20px;
  background: rgba(139, 92, 246, .08);
  color: #a78bfa;
  border: 1px solid rgba(139, 92, 246, .18);
}
```

**Où placer le badge dans les templates Angular :**

```html
<!-- Sur les tabs session -->
<div class="session-tabs">
  <button class="session-tab" ...>① Dashboard actuel</button>
  <button class="session-tab" ...>
    ② Matin — pré-session
    <span class="badge-beta">BÊTA</span>
  </button>
  <button class="session-tab" ...>
    ③ Session live
    <span class="badge-beta">BÊTA</span>
  </button>
</div>

<!-- Sur le titre du composant session-morning -->
<div class="card-header">
  <div class="card-title">
    Prépare ta session
    <span class="badge-beta">BÊTA</span>
  </div>
</div>

<!-- Sur le titre du live feed -->
<div class="card-title">
  Live feed — Aujourd'hui
  <span class="badge-beta">BÊTA</span>
</div>

<!-- Sur le titre du calendrier économique -->
<div class="card-title">
  📅 Calendrier
  <span class="badge-beta">BÊTA</span>
</div>

<!-- Sur le titre du trade rapide -->
<div class="card-title">
  ⚡ Trade rapide
  <span class="badge-beta">BÊTA</span>
</div>
```

**Règles d'utilisation du badge :**
- Un seul badge par section — sur le titre de la card ou du composant, jamais partout
- Ne pas mettre de badge sur les stat cards (P&L, Win Rate, etc.) — elles sont partagées V1/V2
- Ne pas mettre de badge sur les éléments du recap "Hier" — c'est une donnée, pas une feature bêta
- Le badge disparaît automatiquement quand `userStore.isBeta()` est false (le bloc entier est masqué)

---
### Validation étape 0

```bash
pnpm nx test api-mytradingcoach --testPathPattern=beta.guard
pnpm nx test app-mytradingcoach --testPathPattern=user.store
pnpm nx build api-mytradingcoach --configuration=production
pnpm nx build app-mytradingcoach --configuration=production
```

**✅ Attendu : BetaGuard testé, isBeta computed OK, dashboard V1 intact pour les non-beta, build OK**

---

## ÉTAPE 1 — Schéma Prisma : nouveaux modèles V2

**Agent : prisma**

### 1.1 Nouveaux modèles à ajouter dans `prisma/schema.prisma`

```prisma
model TradingSession {
  id            String          @id @default(cuid())
  userId        String
  user          User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  startedAt     DateTime        @default(now())
  endedAt       DateTime?
  moodStart     MoodState?      // humeur au démarrage
  moodEnd       MoodState?      // humeur à la clôture
  totalPnl      Float?          // calculé à la clôture
  totalTrades   Int             @default(0)
  winRate       Float?
  status        SessionStatus   @default(ACTIVE)
  notes         String?
  createdAt     DateTime        @default(now())

  @@index([userId, startedAt])
  @@index([userId, status])
}

model DailyRecap {
  id               String   @id @default(cuid())
  userId           String
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  date             DateTime // date du jour (minuit UTC)
  tradesCount      Int      @default(0)
  pnl              Float    @default(0)
  winRate          Float    @default(0)
  dominantEmotion  String?
  aiOneLiner       String?  // phrase IA — Premium uniquement
  generatedAt      DateTime @default(now())

  @@unique([userId, date])
  @@index([userId, date])
}

model EcoCalendarCache {
  id          String   @id @default(cuid())
  date        DateTime // date du jour
  rawData     Json     // données brutes API
  aiAnalysis  Json     // analyse IA par actif
  generatedAt DateTime @default(now())

  @@unique([date])
  @@index([date])
}

enum MoodState {
  CONFIDENT
  FOCUSED
  NEUTRAL
  TIRED
  STRESSED
}

enum SessionStatus {
  ACTIVE
  CLOSED
}
```

### 1.2 Mettre à jour le modèle `User` — ajouter les relations

```prisma
model User {
  // ... champs existants ...
  tradingSessions  TradingSession[]
  dailyRecaps      DailyRecap[]
}
```

### 1.3 Mettre à jour le modèle `Trade` — lier à la session

```prisma
model Trade {
  // ... champs existants ...
  sessionId       String?
  tradingSession  TradingSession? @relation(fields: [sessionId], references: [id])
  exitPrice       Float?          // alias de exit pour clarté
}
```

### 1.4 Commandes

```bash
pnpm dlx prisma migrate dev --name v2_session_mode_eco_calendar
pnpm dlx prisma generate
```

### 1.5 Tests Prisma

Vérifier que les migrations passent proprement :

```bash
pnpm dlx prisma validate
pnpm dlx prisma studio  # vérifier les nouveaux modèles visuellement
```

### Validation étape 1

```bash
pnpm nx build api-mytradingcoach --configuration=production
```

**✅ Attendu : build OK, migration appliquée, schéma valide**

---

## ÉTAPE 2 — Backend NestJS : Module Session

**Agent : nestjs**

### 2.1 Créer `src/modules/session/`

Fichiers à créer :
- `session.module.ts`
- `session.controller.ts`
- `session.service.ts`
- `dto/create-session.dto.ts`
- `dto/close-session.dto.ts`
- `dto/quick-trade.dto.ts`

### 2.2 `session.service.ts`

```typescript
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: Redis,
  ) {}

  // Démarrer une session
  async startSession(userId: string, mood: MoodState): Promise<TradingSession> {
    // Fermer toute session ACTIVE existante d'abord
    await this.prisma.tradingSession.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'CLOSED', endedAt: new Date() },
    });

    const session = await this.prisma.tradingSession.create({
      data: { userId, moodStart: mood, status: 'ACTIVE' },
    });

    // Stocker en Redis pour accès rapide
    await this.redis.setex(
      `session:active:${userId}`,
      60 * 60 * 24,
      session.id,
    );

    return session;
  }

  // Obtenir la session active
  async getActiveSession(userId: string) {
    const session = await this.prisma.tradingSession.findFirst({
      where: { userId, status: 'ACTIVE' },
      include: {
        // Trades liés à cette session
        _count: { select: { Trade: true } },
      },
    });
    return session;
  }

  // Clôturer une session
  async closeSession(
    userId: string,
    sessionId: string,
    mood: MoodState,
    notes?: string,
  ) {
    // Calculer les stats de la session
    const trades = await this.prisma.trade.findMany({
      where: { userId, sessionId },
    });

    const closed = trades.filter(t => t.pnl !== null);
    const wins = closed.filter(t => (t.pnl ?? 0) > 0);
    const totalPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

    const session = await this.prisma.tradingSession.update({
      where: { id: sessionId, userId },
      data: {
        status: 'CLOSED',
        endedAt: new Date(),
        moodEnd: mood,
        totalPnl,
        totalTrades: trades.length,
        winRate,
        notes,
      },
    });

    await this.redis.del(`session:active:${userId}`);
    return session;
  }

  // Trades du jour (pour le live feed)
  async getTodayTrades(userId: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    return this.prisma.trade.findMany({
      where: {
        userId,
        tradedAt: { gte: startOfDay },
      },
      orderBy: { tradedAt: 'desc' },
    });
  }

  // Clôturer un trade (prix de sortie → détecter SL/TP/Manuel)
  async closeTrade(
    userId: string,
    tradeId: string,
    exitPrice: number,
  ) {
    const trade = await this.prisma.trade.findFirst({
      where: { id: tradeId, userId },
    });
    if (!trade) throw new NotFoundException('Trade introuvable');

    // Détecter SL / TP / Manuel
    let closeType: 'SL' | 'TP' | 'MANUAL' = 'MANUAL';
    if (trade.stopLoss !== null && trade.stopLoss !== undefined) {
      const isSL =
        trade.side === 'LONG'
          ? exitPrice <= trade.stopLoss
          : exitPrice >= trade.stopLoss;
      if (isSL) closeType = 'SL';
    }
    if (trade.takeProfit !== null && trade.takeProfit !== undefined) {
      const isTP =
        trade.side === 'LONG'
          ? exitPrice >= trade.takeProfit
          : exitPrice <= trade.takeProfit;
      if (isTP) closeType = 'TP';
    }

    // Calculer le P&L selon l'instrument
    // Utiliser instruments.const.ts pour le calcul exact
    const rawPoints =
      trade.side === 'LONG'
        ? exitPrice - trade.entry
        : trade.entry - exitPrice;

    // Calcul simplifié — le service instruments gère les cas spéciaux
    const pnl = rawPoints; // TODO: passer par InstrumentsService pour P&L exact

    return this.prisma.trade.update({
      where: { id: tradeId },
      data: {
        exit: exitPrice,
        exitPrice,
        pnl,
        tags: { push: closeType },
      },
    });
  }

  // Stats live de la session en cours
  async getLiveStats(userId: string) {
    const todayTrades = await this.getTodayTrades(userId);
    const closed = todayTrades.filter(t => t.pnl !== null);
    const wins = closed.filter(t => (t.pnl ?? 0) > 0);

    return {
      totalPnl: closed.reduce((s, t) => s + (t.pnl ?? 0), 0),
      winRate:
        closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
      tradesCount: todayTrades.length,
      closedCount: closed.length,
      trades: todayTrades,
    };
  }
}
```

### 2.3 `session.controller.ts`

```typescript
@Controller('session')
@UseGuards(JwtAuthGuard)
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Post('start')
  start(
    @CurrentUser() user: User,
    @Body() dto: CreateSessionDto,
  ) {
    return this.sessionService.startSession(user.id, dto.mood);
  }

  @Get('active')
  getActive(@CurrentUser() user: User) {
    return this.sessionService.getActiveSession(user.id);
  }

  @Post(':id/close')
  close(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: CloseSessionDto,
  ) {
    return this.sessionService.closeSession(user.id, id, dto.mood, dto.notes);
  }

  @Get('today/trades')
  getTodayTrades(@CurrentUser() user: User) {
    return this.sessionService.getTodayTrades(user.id);
  }

  @Get('today/stats')
  getLiveStats(@CurrentUser() user: User) {
    return this.sessionService.getLiveStats(user.id);
  }

  @Post('trades/:id/close')
  closeTrade(
    @CurrentUser() user: User,
    @Param('id') tradeId: string,
    @Body() body: { exitPrice: number },
  ) {
    return this.sessionService.closeTrade(user.id, tradeId, body.exitPrice);
  }
}
```

### 2.4 DTOs

```typescript
// create-session.dto.ts
export class CreateSessionDto {
  @IsEnum(MoodState)
  mood: MoodState;
}

// close-session.dto.ts
export class CloseSessionDto {
  @IsEnum(MoodState)
  mood: MoodState;

  @IsOptional()
  @IsString()
  notes?: string;
}
```

### 2.5 Enregistrer dans `app.module.ts`

```typescript
import { SessionModule } from './modules/session/session.module';
// Ajouter SessionModule dans imports
```

### 2.6 Tests unitaires `session.service.spec.ts`

```typescript
describe('SessionService', () => {
  it('démarre une session et ferme la précédente active', async () => { ... });
  it('getTodayTrades retourne uniquement les trades du jour', async () => { ... });
  it('closeTrade détecte SL correctement pour un LONG', async () => {
    // entry=100, SL=95, exitPrice=94 → SL
  });
  it('closeTrade détecte TP correctement pour un LONG', async () => {
    // entry=100, TP=110, exitPrice=112 → TP
  });
  it('closeTrade détecte Manuel si ni SL ni TP touché', async () => { ... });
  it('getLiveStats calcule le winRate correctement', async () => { ... });
});
```

### Validation étape 2

```bash
pnpm nx test api-mytradingcoach
pnpm nx build api-mytradingcoach --configuration=production
```

**✅ Attendu : SessionService testé, build OK**

---

## ÉTAPE 3 — Backend NestJS : Module Daily Recap

**Agent : nestjs**

### 3.1 Créer `src/modules/daily-recap/`

- `daily-recap.module.ts`
- `daily-recap.service.ts`
- `daily-recap.cron.ts`

### 3.2 `daily-recap.service.ts`

```typescript
@Injectable()
export class DailyRecapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  async generateRecap(userId: string, date: Date): Promise<DailyRecap> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const trades = await this.prisma.trade.findMany({
      where: {
        userId,
        tradedAt: { gte: startOfDay, lte: endOfDay },
        pnl: { not: null },
      },
    });

    if (trades.length === 0) return null;

    // Calculer les stats
    const wins = trades.filter(t => (t.pnl ?? 0) > 0);
    const pnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const winRate = (wins.length / trades.length) * 100;

    // Émotion dominante
    const emotionMap = new Map<string, number>();
    trades.forEach(t => {
      emotionMap.set(t.emotion, (emotionMap.get(t.emotion) ?? 0) + 1);
    });
    const dominantEmotion = [...emotionMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    // Phrase IA — uniquement si Premium et ≥ 3 trades
    let aiOneLiner: string | null = null;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const isPremium = user?.plan === 'PREMIUM';

    if (isPremium && trades.length >= 3) {
      aiOneLiner = await this.aiService.generateDailyOneLiner({
        userId,
        trades,
        pnl,
        winRate,
        dominantEmotion,
      });
    }

    return this.prisma.dailyRecap.upsert({
      where: { userId_date: { userId, date: startOfDay } },
      create: {
        userId,
        date: startOfDay,
        tradesCount: trades.length,
        pnl,
        winRate,
        dominantEmotion,
        aiOneLiner,
      },
      update: {
        tradesCount: trades.length,
        pnl,
        winRate,
        dominantEmotion,
        aiOneLiner,
        generatedAt: new Date(),
      },
    });
  }

  async getYesterdayRecap(userId: string) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    return this.prisma.dailyRecap.findUnique({
      where: { userId_date: { userId, date: yesterday } },
    });
  }
}
```

### 3.3 `daily-recap.cron.ts` — 17h30 Paris

```typescript
@Injectable()
export class DailyRecapCron {
  private readonly logger = new Logger(DailyRecapCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyRecapService: DailyRecapService,
    private readonly resend: ResendService,
  ) {}

  // Générer le recap à 17h30 Paris (fermeture session London/NY overlap)
  @Cron('30 17 * * 1-5', { timeZone: 'Europe/Paris' })
  async generateDailyRecaps() {
    this.logger.log('Generating daily recaps...');
    const today = new Date();

    const activeUsers = await this.prisma.user.findMany({
      where: {
        trades: {
          some: {
            tradedAt: { gte: new Date(today.toDateString()) },
          },
        },
      },
    });

    await Promise.all(
      activeUsers.map(async user => {
        try {
          const recap = await this.dailyRecapService.generateRecap(user.id, today);
          if (recap && recap.tradesCount > 0) {
            // Envoyer email de recap
            await this.resend.sendDailyRecapEmail(user, recap);
          }
        } catch (err) {
          this.logger.error(`Recap failed for user ${user.id}`, err);
        }
      }),
    );
  }
}
```

### 3.4 Ajouter méthode IA dans `AiService` — `generateDailyOneLiner`

```typescript
async generateDailyOneLiner(data: {
  userId: string;
  trades: Trade[];
  pnl: number;
  winRate: number;
  dominantEmotion: string;
}): Promise<string> {
  const prompt = `Session du jour : ${data.trades.length} trades, P&L ${data.pnl > 0 ? '+' : ''}${data.pnl.toFixed(0)}$, win rate ${data.winRate.toFixed(0)}%, émotion dominante : ${data.dominantEmotion}.
Top 3 trades : ${data.trades.slice(0, 3).map(t => `${t.side} ${t.asset} ${t.pnl! > 0 ? '+' : ''}${t.pnl?.toFixed(0)}$`).join(', ')}.
Génère UNE seule phrase coaching (max 120 caractères) : directe, utile, personnalisée. Pas de "Bonne journée" générique.`;

  const response = await this.anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 150,
    messages: [{ role: 'user', content: prompt }],
  });

  await this.logUsage({
    userId: data.userId,
    feature: 'daily_recap',
    usage: response.usage,
  });

  return response.content[0].type === 'text' ? response.content[0].text.trim() : '';
}
```

### 3.5 Template email daily recap dans Resend

Créer `resend/templates/daily-recap.ts` :

```typescript
export function dailyRecapTemplate(user: User, recap: DailyRecap): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="background:#080c14;color:#e2eaf5;font-family:'DM Sans',sans-serif;padding:32px;max-width:480px;margin:0 auto;">
  <div style="margin-bottom:24px;">
    <span style="font-family:'Syne',sans-serif;font-size:18px;font-weight:700;">MyTradingCoach</span>
  </div>
  <h2 style="font-size:20px;margin-bottom:4px;">Session du ${new Date(recap.date).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' })}</h2>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:20px 0;">
    <div style="background:#0f1824;border:1px solid rgba(99,155,255,.1);border-radius:8px;padding:12px;text-align:center;">
      <div style="font-family:'DM Mono',monospace;font-size:18px;font-weight:700;color:${recap.pnl >= 0 ? '#10b981' : '#ef4444'};">${recap.pnl >= 0 ? '+' : ''}${recap.pnl.toFixed(0)}$</div>
      <div style="font-size:10px;color:#4a6080;">P&L</div>
    </div>
    <div style="background:#0f1824;border:1px solid rgba(99,155,255,.1);border-radius:8px;padding:12px;text-align:center;">
      <div style="font-family:'DM Mono',monospace;font-size:18px;font-weight:700;">${recap.winRate.toFixed(0)}%</div>
      <div style="font-size:10px;color:#4a6080;">Win Rate</div>
    </div>
    <div style="background:#0f1824;border:1px solid rgba(99,155,255,.1);border-radius:8px;padding:12px;text-align:center;">
      <div style="font-family:'DM Mono',monospace;font-size:18px;font-weight:700;">${recap.tradesCount}</div>
      <div style="font-size:10px;color:#4a6080;">Trades</div>
    </div>
  </div>
  ${recap.aiOneLiner ? `<div style="background:rgba(59,130,246,.07);border:1px solid rgba(59,130,246,.18);border-radius:8px;padding:14px;font-size:13px;color:#e2eaf5;line-height:1.5;margin-bottom:20px;">✦ ${recap.aiOneLiner}</div>` : ''}
  <a href="https://app.mytradingcoach.app/dashboard" style="display:block;background:#3b82f6;color:white;text-align:center;padding:12px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;">Ouvrir mon dashboard →</a>
</body>
</html>`;
}
```

### 3.6 Ajouter l'endpoint dans le controller analytics

```typescript
// analytics.controller.ts
@Get('daily-recap/yesterday')
@UseGuards(JwtAuthGuard)
getYesterdayRecap(@CurrentUser() user: User) {
  return this.dailyRecapService.getYesterdayRecap(user.id);
}
```

### 3.7 Tests `daily-recap.service.spec.ts`

```typescript
describe('DailyRecapService', () => {
  it('génère un recap avec stats correctes', async () => { ... });
  it('ne génère pas de aiOneLiner pour un user FREE', async () => { ... });
  it('ne génère pas de aiOneLiner si < 3 trades', async () => { ... });
  it('retourne null si aucun trade aujourd\\'hui', async () => { ... });
  it('upsert correctement si recap existant', async () => { ... });
});
```

### Validation étape 3

```bash
pnpm nx test api-mytradingcoach
pnpm nx build api-mytradingcoach --configuration=production
```

**✅ Attendu : DailyRecapService testé, cron enregistré, build OK**

---

## ÉTAPE 4 — Backend NestJS : Calendrier Économique

**Agent : nestjs**

### 4.1 Créer `src/modules/eco-calendar/`

- `eco-calendar.module.ts`
- `eco-calendar.service.ts`
- `eco-calendar.controller.ts`
- `eco-calendar.cron.ts`

### 4.2 Source de données — API ForexFactory (scraping public)

Utiliser `investing-com-api` ou une requête HTTP simple vers l'API publique de TradingEconomics/ForexFactory. Alternative recommandée : **`financialmodelingprep.com`** (250 req/jour gratuit).

```bash
# Variable d'environnement à ajouter
FINANCIAL_MODELING_PREP_API_KEY=<clé gratuite>
```

### 4.3 `eco-calendar.service.ts`

```typescript
@Injectable()
export class EcoCalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly redis: Redis,
  ) {}

  // Récupérer les events du jour (avec cache Redis 1h)
  async getTodayEvents(userId: string) {
    const today = new Date().toISOString().slice(0, 10);
    const cacheKey = `eco:calendar:${today}:${userId}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // Récupérer les événements depuis l'API
    const events = await this.fetchEconomicEvents(today);

    // Récupérer les top actifs du user
    const userAssets = await this.getUserTopAssets(userId);

    // Analyse IA personnalisée
    const analysis = await this.aiService.analyzeEcoEvents({
      userId,
      events,
      userAssets,
    });

    const result = { events, analysis, userAssets };

    // Cache 1h
    await this.redis.setex(cacheKey, 3600, JSON.stringify(result));

    return result;
  }

  private async fetchEconomicEvents(date: string) {
    const apiKey = process.env.FINANCIAL_MODELING_PREP_API_KEY;
    const url = `https://financialmodelingprep.com/api/v3/economic_calendar?from=${date}&to=${date}&apikey=${apiKey}`;

    const response = await fetch(url);
    const data = await response.json();

    // Filtrer les événements à fort/moyen impact
    return data
      .filter((e: any) => ['High', 'Medium'].includes(e.impact))
      .map((e: any) => ({
        time: e.date,
        name: e.event,
        impact: e.impact === 'High' ? 'high' : 'medium',
        country: e.country,
        currency: e.currency,
        actual: e.actual,
        estimate: e.estimate,
        previous: e.previous,
        isReleased: e.actual !== null,
      }));
  }

  private async getUserTopAssets(userId: string) {
    const trades = await this.prisma.trade.findMany({
      where: { userId },
      select: { asset: true },
      take: 100,
      orderBy: { tradedAt: 'desc' },
    });

    const count = new Map<string, number>();
    trades.forEach(t => count.set(t.asset, (count.get(t.asset) ?? 0) + 1));

    return [...count.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([asset]) => asset);
  }

  // Analyse d'un résultat tombé — appelé en temps réel
  async analyzeReleasedEvent(userId: string, eventId: string) {
    const userAssets = await this.getUserTopAssets(userId);
    const today = new Date().toISOString().slice(0, 10);
    const cached = await this.redis.get(`eco:calendar:${today}:${userId}`);
    if (!cached) return null;

    const { events } = JSON.parse(cached);
    const event = events.find((e: any) => e.name === eventId);
    if (!event || !event.isReleased) return null;

    return this.aiService.analyzeEcoResult({ userId, event, userAssets });
  }
}
```

### 4.4 Méthodes IA dans `AiService`

```typescript
// Analyse calendrier matin (générée à 7h)
async analyzeEcoEvents(data: {
  userId: string;
  events: EcoEvent[];
  userAssets: string[];
}): Promise<EcoAnalysis> {
  const prompt = `Tu es un coach de trading expert.
Actifs du trader : ${data.userAssets.join(', ')}.
Événements économiques du jour : ${JSON.stringify(data.events, null, 2)}.
Génère un JSON : {
  "summary": "1-2 phrases sur les risques du jour pour ce trader précis",
  "recommendation": "1 conseil actionnable concret (créneau à éviter, actif sensible)",
  "assetImpacts": [{ "asset": string, "sentiment": "bull"|"bear"|"neutral", "reason": string }]
}`;

  const response = await this.anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  await this.logUsage({ userId: data.userId, feature: 'eco_calendar', usage: response.usage });
  return JSON.parse(this.clean(response.content[0].text));
}

// Analyse d'un résultat tombé en temps réel
async analyzeEcoResult(data: {
  userId: string;
  event: EcoEvent;
  userAssets: string[];
}): Promise<EcoResultAnalysis> {
  const surprise = data.event.actual - data.event.estimate;
  const prompt = `Résultat tombé : ${data.event.name}.
Résultat : ${data.event.actual} | Prévu : ${data.event.estimate} | Précédent : ${data.event.previous}.
Surprise : ${surprise > 0 ? '+' : ''}${surprise.toFixed(2)}.
Actifs tradés : ${data.userAssets.join(', ')}.
Génère un JSON : {
  "interpretation": "phrase courte expliquant la surprise",
  "assetSentiments": [{ "asset": string, "sentiment": "bull"|"bear"|"neutral", "shortReason": string }]
}`;

  const response = await this.anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  await this.logUsage({ userId: data.userId, feature: 'eco_calendar', usage: response.usage });
  return JSON.parse(this.clean(response.content[0].text));
}
```

### 4.5 Controller

```typescript
@Controller('eco-calendar')
@UseGuards(JwtAuthGuard, PremiumGuard)
export class EcoCalendarController {
  constructor(private readonly service: EcoCalendarService) {}

  @Get('today')
  getTodayEvents(@CurrentUser() user: User) {
    return this.service.getTodayEvents(user.id);
  }

  @Post('analyze-result')
  analyzeResult(
    @CurrentUser() user: User,
    @Body('eventName') eventName: string,
  ) {
    return this.service.analyzeReleasedEvent(user.id, eventName);
  }
}
```

### 4.6 Cron 7h — pré-génération

```typescript
// eco-calendar.cron.ts
@Cron('0 7 * * 1-5', { timeZone: 'Europe/Paris' })
async pregenerateCalendar() {
  const premiumUsers = await this.prisma.user.findMany({
    where: { plan: 'PREMIUM' },
    select: { id: true },
  });

  await Promise.all(
    premiumUsers.map(u =>
      this.ecoCalendarService.getTodayEvents(u.id).catch(() => null),
    ),
  );
}
```

### 4.7 Tests `eco-calendar.service.spec.ts`

```typescript
describe('EcoCalendarService', () => {
  it('retourne les données depuis le cache Redis si disponible', async () => { ... });
  it('getUserTopAssets retourne les 5 actifs les plus tradés', async () => { ... });
  it('analyzeReleasedEvent retourne null si event non publié', async () => { ... });
  it('calcule correctement la surprise (actual - estimate)', async () => { ... });
});
```

### Validation étape 4

```bash
pnpm nx test api-mytradingcoach
pnpm nx build api-mytradingcoach --configuration=production
```

**✅ Attendu : EcoCalendarService testé, build OK**

---

## ÉTAPE 5 — Frontend Angular : API Services

**Agent : angular**

### 5.1 Créer `src/app/core/api/session.api.ts`

```typescript
@Injectable({ providedIn: 'root' })
export class SessionApi {
  private http = inject(HttpClient);
  private base = inject(ApiConfig).base;

  startSession(mood: MoodState) {
    return this.http.post<TradingSession>(`${this.base}/session/start`, { mood });
  }

  getActiveSession() {
    return this.http.get<TradingSession | null>(`${this.base}/session/active`);
  }

  closeSession(id: string, mood: MoodState, notes?: string) {
    return this.http.post<TradingSession>(`${this.base}/session/${id}/close`, { mood, notes });
  }

  getTodayTrades() {
    return this.http.get<Trade[]>(`${this.base}/session/today/trades`);
  }

  getLiveStats() {
    return this.http.get<LiveStats>(`${this.base}/session/today/stats`);
  }

  closeTrade(tradeId: string, exitPrice: number) {
    return this.http.post<Trade>(`${this.base}/session/trades/${tradeId}/close`, { exitPrice });
  }
}
```

### 5.2 Créer `src/app/core/api/eco-calendar.api.ts`

```typescript
@Injectable({ providedIn: 'root' })
export class EcoCalendarApi {
  private http = inject(HttpClient);
  private base = inject(ApiConfig).base;

  getTodayEvents() {
    return this.http.get<EcoCalendarData>(`${this.base}/eco-calendar/today`);
  }

  analyzeResult(eventName: string) {
    return this.http.post<EcoResultAnalysis>(
      `${this.base}/eco-calendar/analyze-result`,
      { eventName },
    );
  }
}
```

### 5.3 Créer `src/app/core/api/daily-recap.api.ts`

```typescript
@Injectable({ providedIn: 'root' })
export class DailyRecapApi {
  private http = inject(HttpClient);
  private base = inject(ApiConfig).base;

  getYesterdayRecap() {
    return this.http.get<DailyRecap | null>(`${this.base}/analytics/daily-recap/yesterday`);
  }
}
```

### 5.4 Interfaces TypeScript à créer dans `src/app/core/models/`

```typescript
// session.model.ts
export interface TradingSession {
  id: string;
  userId: string;
  startedAt: string;
  endedAt?: string;
  moodStart?: MoodState;
  moodEnd?: MoodState;
  totalPnl?: number;
  totalTrades: number;
  winRate?: number;
  status: 'ACTIVE' | 'CLOSED';
}

export interface LiveStats {
  totalPnl: number;
  winRate: number;
  tradesCount: number;
  closedCount: number;
  trades: Trade[];
}

// eco-calendar.model.ts
export interface EcoEvent {
  time: string;
  name: string;
  impact: 'high' | 'medium' | 'low';
  country: string;
  currency: string;
  actual?: number;
  estimate?: number;
  previous?: number;
  isReleased: boolean;
}

export interface EcoCalendarData {
  events: EcoEvent[];
  analysis: {
    summary: string;
    recommendation: string;
    assetImpacts: { asset: string; sentiment: 'bull' | 'bear' | 'neutral'; reason: string }[];
  };
  userAssets: string[];
}

// daily-recap.model.ts
export interface DailyRecap {
  id: string;
  date: string;
  tradesCount: number;
  pnl: number;
  winRate: number;
  dominantEmotion?: string;
  aiOneLiner?: string;
}

export type MoodState = 'CONFIDENT' | 'FOCUSED' | 'NEUTRAL' | 'TIRED' | 'STRESSED';
```

### Validation étape 5

```bash
pnpm nx build app-mytradingcoach --configuration=production
```

**✅ Attendu : API services créés, interfaces typées, build OK**

---

## ÉTAPE 6 — Frontend Angular : Composant Dashboard V2

**Agent : angular + design**

### 6.1 Vue d'ensemble

Le dashboard devient **context-aware** selon l'heure et l'état de la session :
- **Pas de session** → vue Matin (mood check + recap hier + objectifs + calendrier)
- **Session ACTIVE** → vue Live (live feed + trade rapide inline + calendrier)
- **Session CLOSED aujourd'hui** → vue Post-session (résumé de la session)

### 6.2 Modifier `dashboard.component.ts`

```typescript
@Component({
  selector: 'mtc-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit {
  private sessionApi = inject(SessionApi);
  private ecoCalendarApi = inject(EcoCalendarApi);
  private dailyRecapApi = inject(DailyRecapApi);
  private analyticsApi = inject(AnalyticsApi);
  private debriefApi = inject(DebriefApi);
  private destroyRef = inject(DestroyRef);

  // État de la session
  activeSession = signal<TradingSession | null>(null);
  todayStats = signal<LiveStats | null>(null);
  todayTrades = signal<Trade[]>([]);

  // Données pre-session
  yesterdayRecap = signal<DailyRecap | null>(null);
  currentObjectives = signal<DebriefObjective[]>([]);
  ecoCalendar = signal<EcoCalendarData | null>(null);

  // Stats globales (inchangées)
  summary = httpResource(() => `${this.base}/analytics/summary`);

  // Vue active
  dashboardView = computed<'morning' | 'live' | 'post-session'>(() => {
    if (this.activeSession()?.status === 'ACTIVE') return 'live';
    return 'morning';
  });

  // Mood sélectionné
  selectedMood = signal<MoodState>('CONFIDENT');

  // Trade en cours de clôture
  closingTradeId = signal<string | null>(null);
  closePanelOpen = signal(false);

  // Quick trade inline
  quickTradeAsset = signal('');
  quickTradeSide = signal<'LONG' | 'SHORT'>('LONG');
  quickTradeEmotion = signal<EmotionState>('CONFIDENT');
  quickTradeEntry = signal('');
  quickTradeSL = signal('');
  quickTradeTP = signal('');

  // P&L calculé automatiquement
  quickTradePnl = computed(() => {
    const entry = parseFloat(this.quickTradeEntry());
    const tp = parseFloat(this.quickTradeTP());
    const sl = parseFloat(this.quickTradeSL());
    if (!entry || !tp) return null;
    const pnl = this.quickTradeSide() === 'LONG' ? tp - entry : entry - tp;
    const risk = sl ? Math.abs(this.quickTradeSide() === 'LONG' ? entry - sl : sl - entry) : null;
    const rr = risk && risk > 0 ? Math.abs(pnl) / risk : null;
    return { pnl, rr };
  });

  ngOnInit() {
    this.loadDashboardData();
    // Polling live stats toutes les 30s pendant une session
    interval(30000)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter(() => this.dashboardView() === 'live'),
      )
      .subscribe(() => this.refreshLiveStats());
  }

  private loadDashboardData() {
    // Session active
    this.sessionApi.getActiveSession().subscribe(s => this.activeSession.set(s));
    // Recap hier
    this.dailyRecapApi.getYesterdayRecap().subscribe(r => this.yesterdayRecap.set(r));
    // Calendrier (Premium)
    this.ecoCalendarApi.getTodayEvents().subscribe(c => this.ecoCalendar.set(c));
    // Objectifs semaine courante
    this.debriefApi.getCurrentObjectives().subscribe(o => this.currentObjectives.set(o));
  }

  startSession() {
    this.sessionApi
      .startSession(this.selectedMood())
      .subscribe(session => {
        this.activeSession.set(session);
        this.refreshLiveStats();
      });
  }

  closeSession(mood: MoodState) {
    const session = this.activeSession();
    if (!session) return;
    this.sessionApi
      .closeSession(session.id, mood)
      .subscribe(() => this.activeSession.set(null));
  }

  openClosePanel(tradeId: string) {
    this.closingTradeId.set(tradeId);
    this.closePanelOpen.set(true);
  }

  confirmCloseTrade(exitPrice: number) {
    const tradeId = this.closingTradeId();
    if (!tradeId) return;
    this.sessionApi.closeTrade(tradeId, exitPrice).subscribe(() => {
      this.closePanelOpen.set(false);
      this.closingTradeId.set(null);
      this.refreshLiveStats();
    });
  }

  logQuickTrade() {
    // POST /api/trades avec les données du formulaire inline
    // entry, sl, tp, asset, side, emotion
    // Après succès → refreshLiveStats()
  }

  private refreshLiveStats() {
    this.sessionApi.getLiveStats().subscribe(stats => {
      this.todayStats.set(stats);
      this.todayTrades.set(stats.trades);
    });
  }

  selectMood(mood: MoodState) { this.selectedMood.set(mood); }
}
```

### 6.3 `dashboard.component.html`

Implémenter les 3 vues en suivant **pixel par pixel** le fichier `mtc-session-mockup-final.html`.

Structure générale :

```html
<!-- Greeting + tabs ① ② ③ -->
<div class="greeting">
  <h1 class="greeting-title">Bonjour, {{ userStore.name() }} 👋</h1>
  <p class="greeting-sub">{{ today | date:'EEEE d MMMM' }}</p>
  <!-- TABS MODE SESSION -->
  <div class="session-tabs">
    <button class="session-tab" [class.active]="dashboardView() === 'morning'" (click)="forceView('morning')">① Dashboard actuel</button>
    <button class="session-tab" [class.active]="dashboardView() === 'morning'" (click)="forceView('morning')">② Matin — pré-session</button>
    <button class="session-tab" [class.active]="dashboardView() === 'live'" (click)="forceView('live')">③ Session live</button>
  </div>
</div>

<!-- 4 STAT CARDS (communes aux 3 vues) -->
<div class="stats-row">
  <!-- P&L, Win Rate, Drawdown, Trades — inchangé -->
</div>

<!-- VUE MATIN -->
@if (dashboardView() === 'morning') {
  <mtc-session-morning
    [yesterdayRecap]="yesterdayRecap()"
    [objectives]="currentObjectives()"
    [ecoCalendar]="ecoCalendar()"
    [selectedMood]="selectedMood()"
    (moodSelected)="selectMood($event)"
    (sessionStarted)="startSession()"
  />
}

<!-- VUE LIVE -->
@if (dashboardView() === 'live') {
  <mtc-session-live
    [session]="activeSession()"
    [todayTrades]="todayTrades()"
    [liveStats]="todayStats()"
    [ecoCalendar]="ecoCalendar()"
    (tradeClosed)="confirmCloseTrade($event)"
    (sessionClosed)="closeSession($event)"
  />
}
```

### 6.4 Créer `src/app/features/dashboard/components/session-morning/`

Composant **pré-session** avec :
- Banner mood check (4 boutons : 😎 Confiant / 🎯 Focalisé / 😐 Neutre / 😰 Fatigué)
- Bouton "Démarrer la session →"
- Card "Hier" : P&L / Win Rate / Émotion dominante + phrase IA
- Card "Objectifs semaine" : liste avec checkboxes visuelles
- Calendrier économique : events du jour filtrés, analyse IA personnalisée

### 6.5 Créer `src/app/features/dashboard/components/session-live/`

Composant **session en cours** avec :
- Barre session active (timer, P&L live, état, bouton clôturer)
- 4 mini-stats (P&L jour, Win Rate, Émotion, Trades logués)
- Layout 3 colonnes (1fr 2fr 1fr) :
  - **Live feed** : trades du jour avec entry/exit/SL/TP/type, trade LIVE cliquable → panel clôture
  - **Calendrier** : events du jour, résultats tombés avec sentiment bull/bear
  - **Trade rapide** : formulaire inline (asset, LONG/SHORT, émotion, entry/SL/TP optionnels)

### 6.6 CSS — `dashboard.component.css`

> **Rappel règle absolue :** ne pas modifier le CSS existant du dashboard. Ajouter uniquement de nouvelles classes pour les éléments V2. Si une classe existe déjà (`.stat-card`, `.card`, `.card-header`, `.btn-primary`...) → l'utiliser directement, ne pas la redéfinir.

Ajouter uniquement ces nouvelles classes en suivant les tokens du design system (`design.md`) :

```css
/* Tabs session */
.session-tabs {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}

.session-tab {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  font-family: var(--font-body);
  cursor: pointer;
  transition: all .15s;
  color: var(--text-3);
}

.session-tab:hover {
  background: var(--blue-glow);
  border-color: var(--blue);
  color: var(--text-2);
}

.session-tab.active {
  background: rgba(59, 130, 246, .12);
  border-color: var(--blue);
  color: var(--blue-bright);
  font-weight: 500;
}

/* Session active bar */
.session-active-bar {
  background: linear-gradient(90deg, rgba(16,185,129,.07), rgba(59,130,246,.04));
  border: 1px solid rgba(16, 185, 129, .18);
  border-radius: 10px;
  padding: 12px 18px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}

/* Live layout 3 colonnes */
.live-layout {
  display: grid;
  grid-template-columns: 1fr 2fr 1fr;
  gap: 12px;
  align-items: start;
}

@media (max-width: 1200px) {
  .live-layout { grid-template-columns: 1fr 1fr; }
}

@media (max-width: 768px) {
  .live-layout { grid-template-columns: 1fr; }
  .session-tabs { flex-wrap: wrap; }
}
```

### 6.7 data-testid obligatoires

```html
<div data-testid="session-morning-view">
<div data-testid="session-live-view">
<button data-testid="mood-confident">
<button data-testid="mood-focused">
<button data-testid="start-session">
<button data-testid="close-session">
<div data-testid="yesterday-recap">
<div data-testid="today-objectives">
<div data-testid="eco-calendar">
<div data-testid="live-feed">
<div data-testid="quick-trade-form">
<input data-testid="quick-trade-asset">
<button data-testid="quick-trade-long">
<button data-testid="quick-trade-short">
<button data-testid="quick-trade-submit">
<div data-testid="trade-close-panel">
<input data-testid="trade-exit-price">
<div data-testid="trade-close-type">
```

### 6.8 Tests Angular `dashboard.component.spec.ts`

```typescript
describe('DashboardComponent', () => {
  it('affiche la vue morning quand aucune session active', () => { ... });
  it('affiche la vue live quand session ACTIVE', () => { ... });
  it('démarrer une session appelle sessionApi.startSession avec le bon mood', () => { ... });
  it('quickTradePnl calcule correctement pour un LONG', () => {
    // entry=100, TP=110, SL=95 → pnl=+10, rr=2
  });
  it('quickTradePnl calcule correctement pour un SHORT', () => {
    // entry=100, TP=90 → pnl=+10
  });
  it('selectMood met à jour selectedMood signal', () => { ... });
});
```

### 6.9 Mettre à jour `app-mytradingcoach.html`

Après l'implémentation, synchroniser :
- `id="view-dashboard"` avec le nouveau template
- Ajouter les sections `view-morning` et `view-live`

### Validation étape 6

```bash
pnpm nx test app-mytradingcoach
pnpm nx build app-mytradingcoach --configuration=production
```

**✅ Attendu : Dashboard V2 complet, tests verts, build OK**

---

## ÉTAPE 7 — Tests E2E Playwright

**Agent : tests**

### 7.1 Créer `e2e/08-session-mode.spec.ts`

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Mode Session V2', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'test@example.com', 'password');
    // Mocker les APIs
    await page.route('**/api/session/active', route =>
      route.fulfill({ status: 200, body: JSON.stringify(null) })
    );
    await page.route('**/api/analytics/daily-recap/yesterday', route =>
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          pnl: 620, winRate: 72, tradesCount: 12,
          dominantEmotion: 'CONFIDENT',
          aiOneLiner: 'Bonne session, évite les news.',
        }),
      })
    );
    await page.route('**/api/eco-calendar/today', route =>
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          events: [{ name: 'PMI Zone Euro', time: '10:00', impact: 'high', isReleased: false }],
          analysis: { summary: 'Journée chargée.', recommendation: 'Évite EUR/USD à 10h.', assetImpacts: [] },
          userAssets: ['NQ', 'BTC/USDT'],
        }),
      })
    );
  });

  test('affiche la vue morning par défaut sans session active', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('session-morning-view')).toBeVisible();
    await expect(page.getByTestId('yesterday-recap')).toBeVisible();
    await expect(page.getByTestId('eco-calendar')).toBeVisible();
  });

  test('peut sélectionner une humeur et démarrer une session', async ({ page }) => {
    await page.route('**/api/session/start', route =>
      route.fulfill({
        status: 201,
        body: JSON.stringify({ id: 'session-1', status: 'ACTIVE', moodStart: 'CONFIDENT' }),
      })
    );
    await page.goto('/dashboard');
    await page.getByTestId('mood-focused').click();
    await page.getByTestId('start-session').click();
    await expect(page.getByTestId('session-live-view')).toBeVisible();
  });

  test('affiche la vue live avec le live feed quand session active', async ({ page }) => {
    await page.route('**/api/session/active', route =>
      route.fulfill({
        status: 200,
        body: JSON.stringify({ id: 'session-1', status: 'ACTIVE', moodStart: 'CONFIDENT' }),
      })
    );
    await page.route('**/api/session/today/stats', route =>
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          totalPnl: 880, winRate: 75, tradesCount: 4, closedCount: 3,
          trades: [],
        }),
      })
    );
    await page.goto('/dashboard');
    await expect(page.getByTestId('session-live-view')).toBeVisible();
    await expect(page.getByTestId('live-feed')).toBeVisible();
    await expect(page.getByTestId('quick-trade-form')).toBeVisible();
  });

  test('peut remplir et soumettre un trade rapide', async ({ page }) => {
    // Setup session active...
    await page.goto('/dashboard');
    await page.getByTestId('quick-trade-asset').fill('NQ');
    await page.getByTestId('quick-trade-long').click();
    await page.getByTestId('quick-trade-submit').click();
    // Vérifier que le trade apparaît dans le live feed
  });

  test('détecte SL/TP/Manuel à la clôture d\\'un trade', async ({ page }) => {
    // Cliquer sur un trade LIVE → panel clôture → entrer prix
    // Vérifier le badge SL/TP/Manuel
  });
});
```

### 7.2 Créer `e2e/09-eco-calendar.spec.ts`

```typescript
test.describe('Calendrier Économique', () => {
  test('affiche les événements du jour dans la pré-session', async ({ page }) => {
    // ...
  });

  test('affiche l\\'analyse IA des événements publiés en session live', async ({ page }) => {
    // Mocker un event avec actual != null
    // Vérifier les chips bull/bear
  });

  test('masque les événements hors session (opacité réduite)', async ({ page }) => {
    // ...
  });
});
```

### Validation étape 7

```bash
pnpm nx e2e app-mytradingcoach-e2e
```

**✅ Attendu : tous les tests E2E passent**

---

## ÉTAPE 8 — Agents `.claude/agents/` — Mise à jour

### 8.1 Mettre à jour `nestjs.md`

Ajouter dans la section **API REST** :

```
POST   /api/session/start              JWT → démarrer une session, accepte { mood }
GET    /api/session/active             JWT → session active en cours
POST   /api/session/:id/close          JWT → clôturer une session
GET    /api/session/today/trades       JWT → trades du jour
GET    /api/session/today/stats        JWT → stats live (P&L, WR, trades)
POST   /api/session/trades/:id/close   JWT → clôturer un trade (exit price → SL/TP/Manuel)
GET    /api/eco-calendar/today         PREMIUM → events du jour + analyse IA
POST   /api/eco-calendar/analyze-result PREMIUM → analyse d'un résultat tombé
GET    /api/analytics/daily-recap/yesterday JWT → recap de la veille
```

Ajouter dans la section **AiService** les features :
- `'daily_recap'` — phrase coaching journalière
- `'eco_calendar'` — analyse des événements et résultats

### 8.2 Mettre à jour `angular.md`

Ajouter dans la section **Structure** :

```
├── features/
│   ├── dashboard/
│   │   ├── dashboard.component.ts + .html + .css
│   │   └── components/
│   │       ├── session-morning/     ← VUE PRÉ-SESSION
│   │       └── session-live/        ← VUE SESSION ACTIVE
├── core/
│   ├── api/
│   │   ├── session.api.ts           ← NOUVEAU
│   │   ├── eco-calendar.api.ts      ← NOUVEAU
│   │   └── daily-recap.api.ts       ← NOUVEAU
│   └── models/
│       ├── session.model.ts         ← NOUVEAU
│       ├── eco-calendar.model.ts    ← NOUVEAU
│       └── daily-recap.model.ts     ← NOUVEAU
```

Ajouter dans **data-testid obligatoires** :

```html
<div data-testid="session-morning-view" />
<div data-testid="session-live-view" />
<button data-testid="mood-confident" />
<button data-testid="mood-focused" />
<button data-testid="mood-neutral" />
<button data-testid="mood-tired" />
<button data-testid="start-session" />
<button data-testid="close-session" />
<div data-testid="yesterday-recap" />
<div data-testid="today-objectives" />
<div data-testid="eco-calendar" />
<div data-testid="live-feed" />
<div data-testid="quick-trade-form" />
<input data-testid="quick-trade-asset" />
<button data-testid="quick-trade-long" />
<button data-testid="quick-trade-short" />
<button data-testid="quick-trade-submit" />
<div data-testid="trade-close-panel" />
<input data-testid="trade-exit-price" />
<div data-testid="trade-close-type" />
```

### 8.3 Mettre à jour `prisma.md`

Ajouter dans le schéma les nouveaux modèles (TradingSession, DailyRecap, EcoCalendarCache) et les nouveaux enums (MoodState, SessionStatus).

### 8.4 Mettre à jour `tests.md`

Ajouter dans **Tests critiques NestJS** :

```
├── session.service.spec.ts
│   → démarrer session, fermer session précédente
│   → closeTrade : détection SL, TP, Manuel
│   → getLiveStats : calcul winRate correct
│
├── daily-recap.service.spec.ts
│   → génère recap avec stats correctes
│   → pas de aiOneLiner pour FREE
│   → null si aucun trade
│
└── eco-calendar.service.spec.ts
    → cache Redis retourné si disponible
    → getUserTopAssets retourne les 5 top actifs
    → analyzeReleasedEvent null si non publié
```

Ajouter dans **Specs E2E** :

```
e2e/
├── 08-session-mode.spec.ts     → vue morning, démarrer session, vue live
└── 09-eco-calendar.spec.ts     → events, analyse résultats, bull/bear
```

### Validation étape 8

Vérifier manuellement que les 4 agents sont cohérents avec le code implémenté.

**✅ Attendu : agents mis à jour et cohérents**

---

## ÉTAPE 9 — Build final + deploy sur branche feat/v2-session-mode

### 9.1 Build complet

```bash
# Build de tous les apps
pnpm nx build app-mytradingcoach --configuration=production
pnpm nx build api-mytradingcoach --configuration=production

# Lint
pnpm nx lint app-mytradingcoach
pnpm nx lint api-mytradingcoach

# Tests unitaires complets
pnpm nx test app-mytradingcoach --coverage
pnpm nx test api-mytradingcoach --coverage

# Tests E2E
pnpm nx e2e app-mytradingcoach-e2e
```

### 9.2 Vérification couverture minimale

- **NestJS** : SessionService, DailyRecapService, EcoCalendarService → couverture ≥ 80%
- **Angular** : DashboardComponent, quickTradePnl computed → couverture ≥ 70%

### 9.3 Commit final

```bash
git add .
git commit -m "feat(v2): session mode — morning prep, live feed, quick trade, eco calendar, daily recap"
git push origin feat/v2-session-mode
```

### 9.4 Variables d'environnement à ajouter

Dans `.env.production` et `.env.development` :

```bash
FINANCIAL_MODELING_PREP_API_KEY=<clé gratuite sur financialmodelingprep.com>
```

Dans Bitwarden (notes "MTC — Production" et "MTC — Dev").
Dans GitHub Secrets (environment `production` et `development`).

### Validation étape 9

```bash
# Vérification santé post-deploy dev
curl https://dev.api.mytradingcoach.app/api/health
curl https://dev.api.mytradingcoach.app/api/session/active  # doit répondre 401

# Vérifier les nouveaux endpoints dans Swagger/Postman
```

**✅ Attendu : tous les builds OK, tous les tests verts, branche pushée**

---

## Récapitulatif des nouvelles features V2

| Feature | Visible par | Étape |
|---|---|---|
| BetaGuard + isBeta computed | — (infra) | 0 |
| Mode Matin — mood check | BETA_TESTER + ADMIN | 6 |
| Recap hier (stats) | FREE | 3 + 6 |
| Phrase IA recap | PREMIUM | 3 |
| Objectifs de la semaine | PREMIUM | 6 |
| Calendrier éco — events | PREMIUM | 4 + 6 |
| Calendrier éco — analyse IA | PREMIUM | 4 + 6 |
| Session live — live feed | FREE | 2 + 6 |
| Session live — trade rapide | FREE | 6 |
| Détection SL/TP/Manuel | FREE | 2 + 6 |
| Analyse résultats en temps réel | PREMIUM | 4 + 6 |
| Daily recap email 17h30 | PREMIUM | 3 |

---

## Notes importantes

- La référence design est `mtc-session-mockup-final.html` — ne pas s'en écarter
- Chaque appel Anthropic loggue via `AiUsageLog` (feature: `'daily_recap'` ou `'eco_calendar'`)
- Les mocks Anthropic sont obligatoires dans tous les tests CI
- La branche `feat/v2-session-mode` sera mergée sur `dev` après validation complète
- Ne pas toucher à la landing pendant cette V2 — elle sera mise à jour dans le PROMPT 028
