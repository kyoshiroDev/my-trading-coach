# Agent NestJS — api-mytradingcoach

## Stack
NestJS 11 · Prisma 7 · PostgreSQL 17 · PgBouncer · Redis · BullMQ · Anthropic SDK · Argon2 · JWT Passport

---

## Architecture modules

```
src/modules/
├── auth/      auth.module · auth.controller · auth.service · jwt.strategy · dto/
├── trades/    trades.module · trades.controller · trades.service · dto/
├── analytics/ analytics.module · analytics.controller · analytics.service
├── ai/        ai.module · ai.controller · ai.service · agents/
│              └── agents/
│                  ├── orchestrator.agent.ts
│                  ├── data.agent.ts
│                  ├── pattern.agent.ts
│                  ├── coach.agent.ts
│                  └── debrief.agent.ts
├── debrief/   debrief.module · debrief.controller · debrief.service · debrief.cron
└── users/     users.module · users.service
src/common/
├── guards/        jwt-auth.guard · premium.guard
├── interceptors/  response.interceptor ({ data, meta })
├── decorators/    current-user · public
└── filters/       http-exception.filter
```

---

## API REST

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/refresh
POST   /api/auth/start-trial           → trial 7 jours

GET    /api/trades                     ?page&limit&side&setup&emotion&dateFrom&dateTo
POST   /api/trades                     → vérifier limite 50/mois FREE avant création
PATCH  /api/trades/:id
DELETE /api/trades/:id

GET    /api/analytics/summary          FREE + PREMIUM (pas de PremiumGuard ici)
GET    /api/analytics/by-setup         PREMIUM
GET    /api/analytics/by-emotion       PREMIUM
GET    /api/analytics/by-hour          PREMIUM
GET    /api/analytics/equity-curve     PREMIUM
GET    /api/analytics/top-assets       PREMIUM

POST   /api/ai/insights                PREMIUM → cooldown 4h par user
POST   /api/ai/chat                    PREMIUM → 50 messages/jour par user

GET    /api/debrief/current            PREMIUM
GET    /api/debrief/:year/:week        PREMIUM
GET    /api/debrief/history            PREMIUM
POST   /api/debrief/generate           PREMIUM → 1/jour par user

GET    /api/health
POST   /api/test/upgrade-user          NODE_ENV=test uniquement
```

---

## Règles obligatoires

- `@UseGuards(JwtAuthGuard)` sur toutes les routes protégées
- `@UseGuards(PremiumGuard)` sur routes IA et analytics avancés
- `/api/analytics/summary` : PAS de PremiumGuard (FREE y accède)
- `ValidationPipe` global : `whitelist: true, forbidNonWhitelisted: true`
- Ne jamais appeler Prisma dans les controllers
- Ne jamais `console.log` → Logger NestJS
- Argon2 pour les mots de passe (jamais Bcrypt)
- JWT : access_token 15min, refresh_token 7j httpOnly cookie

---

## Architecture Multi-Agents IA

### Principe
5 agents spécialisés coordonnés par un orchestrateur.
Chaque agent a un seul rôle, un prompt système court et précis.

```
src/modules/ai/agents/
├── orchestrator.agent.ts  ← coordonne, ne fait PAS d'appel Anthropic
├── data.agent.ts          ← calcul pur, ZÉRO appel Anthropic
├── pattern.agent.ts       ← détecte les patterns comportementaux
├── coach.agent.ts         ← génère les conseils actionnables
└── debrief.agent.ts       ← rapport hebdomadaire
```

### data.agent.ts — résumé pré-calculé (ZÉRO token)

```typescript
buildTradesSummary(trades: Trade[]): string {
  const closed = trades.filter(t => t.pnl !== null);
  const wins = closed.filter(t => t.pnl > 0);
  const winRate = closed.length
    ? (wins.length / closed.length * 100).toFixed(1) : '0';
  const totalPnl = closed.reduce((s, t) => s + t.pnl, 0).toFixed(2);

  const group = (key: keyof Trade) => {
    const map = new Map<string, Trade[]>();
    trades.forEach(t => {
      const k = String(t[key]);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(t);
    });
    return map;
  };

  const statLine = (map: Map<string, Trade[]>) =>
    [...map.entries()]
      .map(([k, ts]) => `${k}:${ts.filter(t=>t.pnl>0).length}W/${ts.filter(t=>t.pnl<=0).length}L`)
      .join(', ');

  const top5 = closed
    .sort((a,b) => Math.abs(b.pnl)-Math.abs(a.pnl))
    .slice(0,5)
    .map(t => `${t.asset} ${t.side} ${t.setup} ${t.emotion} PnL:${t.pnl}`)
    .join(' | ');

  return `
RÉSUMÉ (${trades.length} trades, ${closed.length} clôturés)
WinRate:${winRate}% | PnL:$${totalPnl}
Émotions: ${statLine(group('emotion'))}
Setups: ${statLine(group('setup'))}
Sessions: ${statLine(group('session'))}
Top: ${top5}`.trim();
}
```

### pattern.agent.ts — détection patterns

```typescript
const PATTERN_SYSTEM = `Tu es un analyste quantitatif de trading.
Tu identifies UNIQUEMENT les patterns comportementaux statistiquement significatifs.
Réponds TOUJOURS en JSON valide. Jamais de markdown.
Format : { "patterns": [{ "type": string, "title": string, "description": string, "severity": "info"|"warn"|"alert", "badge": string }] }`;

async analyze(summary: string): Promise<Pattern[]> {
  const res = await this.anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: [{ type: 'text', text: PATTERN_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: summary }]
  });
  return JSON.parse(this.clean(res.content[0].text)).patterns;
}
```

### coach.agent.ts — conseils actionnables

```typescript
const COACH_SYSTEM = `Tu es un coach de trading bienveillant mais direct.
Tu transformes des patterns détectés en conseils concrets et actionnables.
Ton de coach, pas d'analyste. Tutoiement. Maximum 3 conseils prioritaires.
Réponds en JSON : { "advice": [{ "title": string, "description": string, "priority": "high"|"medium" }] }`;
```

### orchestrator.agent.ts — coordination

```typescript
async runInsightsFlow(userId: string) {
  // Étape 1 — Data (0 token)
  const trades = await this.tradesService.findAll(userId, { limit: 50 });
  const history = await this.debriefService.getHistory(userId);
  const summary = this.dataAgent.buildTradesSummary(trades);

  // Étape 2 — Pattern (1 appel Anthropic, mis en cache 4h)
  const patterns = await this.patternAgent.analyze(summary);

  // Étape 3 — Coach (1 appel Anthropic)
  const advice = await this.coachAgent.generateAdvice({ patterns, summary, history });

  return { patterns, advice };
}
```

### debrief.agent.ts — rapport hebdomadaire

```typescript
const DEBRIEF_SYSTEM = `Tu es un coach de trading expert. Tu génères des rapports
hebdomadaires synthétiques, bienveillants et actionnables.
Format JSON strict :
{
  "summary": "2-3 phrases coach direct",
  "strengths": [{ "badge": "Force|Très bien", "text": string }],
  "weaknesses": [{ "badge": "Critique|Attention", "text": string }],
  "emotionInsight": "corrélation émotion → performance",
  "objectives": [{ "title": string, "reason": string }]
}`;
```

---

## Prompt caching obligatoire

```typescript
const response = await this.anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  system: [{
    type: 'text',
    text: SYSTEM_PROMPT,
    cache_control: { type: 'ephemeral' }  // caché pour tous les users
  }],
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: tradesSummary, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: userRequest }  // jamais caché
    ]
  }]
});
```

---

## Parsing JSON — nettoyage obligatoire

```typescript
private clean(text: string): string {
  return text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}
```

---

## Limites IA via Redis

```typescript
// Cooldown 4h — insights
async checkInsightsCooldown(userId: string) {
  const key = `ai:cooldown:insights:${userId}`;
  const exists = await this.redis.get(key);
  if (exists) {
    const ttl = await this.redis.ttl(key);
    const minutes = Math.ceil(ttl / 60);
    throw new HttpException(
      `Analyse déjà effectuée. Réessaie dans ${minutes} minute(s).`, 429
    );
  }
  await this.redis.set(key, '1', 'EX', 60 * 60 * 4);
}

// Limite journalière — chat (50/jour) et debrief (1/jour)
async checkDailyLimit(userId: string, action: string, max: number) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `ai:limit:${userId}:${action}:${today}`;
  const count = await this.redis.incr(key);
  await this.redis.expire(key, 60 * 60 * 24);
  if (count > max) {
    throw new HttpException(
      `Limite atteinte : ${max} ${action} par jour. Reviens demain.`, 429
    );
  }
}
```

---

## Gestion erreurs Anthropic

```typescript
} catch (err) {
  const type = err?.error?.error?.type;
  if (type === 'overloaded_error')
    throw new HttpException("L'IA est momentanément surchargée, réessaie dans quelques minutes.", 503);
  if (type === 'rate_limit_error')
    throw new HttpException("Trop de requêtes, réessaie dans quelques secondes.", 429);
  if (type === 'invalid_request_error')
    throw new HttpException("Crédit API insuffisant, contacte le support.", 402);
  throw new HttpException("L'IA est temporairement indisponible.", 502);
}
```

---

## Cache Redis analytics

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

---

## Cron BullMQ — Weekly Debrief

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

## Clustering — règles

- Clustering activé uniquement en `NODE_ENV=production` (4 workers)
- `IS_CRON_WORKER=true` sur 1 seul worker → seul lui exécute `@Cron`
- `ScheduleModule.forRoot()` conditionnel dans `app.module.ts` :
  ```typescript
  ...(process.env['IS_CRON_WORKER'] !== 'false' ? [ScheduleModule.forRoot()] : [])
  ```
- En dev : process unique, pas de clustering, IS_CRON_WORKER non défini → crons actifs normalement

---

## PremiumGuard — logique trial

```typescript
canActivate(ctx: ExecutionContext): boolean {
  const user = ctx.switchToHttp().getRequest().user;
  const isPremium = user.plan === 'PREMIUM';
  const inTrial = user.trialEndsAt && new Date() < new Date(user.trialEndsAt);
  if (isPremium || inTrial) return true;
  throw new ForbiddenException({
    code: 'PREMIUM_REQUIRED',
    trialAvailable: !user.trialUsed
  });
}
```

---

## Validation DTOs (Zod via class-validator)

```typescript
export class CreateTradeDto {
  @IsString() @IsNotEmpty() asset: string;
  @IsEnum(TradeSide) side: TradeSide;
  @IsNumber() @Min(0) entry: number;
  @IsOptional() @IsNumber() exit?: number;
  @IsOptional() @IsNumber() stopLoss?: number;
  @IsOptional() @IsNumber() takeProfit?: number;
  @IsEnum(EmotionState) emotion: EmotionState;
  @IsEnum(SetupType) setup: SetupType;
  @IsEnum(TradingSession) session: TradingSession;
  @IsString() timeframe: string;
  @IsOptional() @IsString() notes?: string;
}
```
