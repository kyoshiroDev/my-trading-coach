# Agent NestJS — api-mytradingcoach

## Stack
NestJS 11 · Prisma 7 · PostgreSQL 17 · PgBouncer · Redis · BullMQ · Anthropic SDK · Argon2 · JWT Passport · Sentry

---

## Architecture modules

```
src/modules/
├── auth/         auth.module · auth.controller · auth.service · jwt.strategy · dto/
├── trades/       trades.module · trades.controller · trades.service · dto/
│                 csv-import.service.ts   ← parsing CSV via Claude SDK (Premium)
├── analytics/    analytics.module · analytics.controller · analytics.service
├── ai/           ai.module · ai.controller · ai.service · agents/
│                 └── agents/
│                     ├── orchestrator.agent.ts
│                     ├── data.agent.ts
│                     ├── pattern.agent.ts
│                     ├── coach.agent.ts
│                     └── debrief.agent.ts
├── debrief/      debrief.module · debrief.controller · debrief.service · debrief.cron
│                 pdf/pdf.service.ts   ← export PDF via puppeteer (Premium)
├── session/      session.module · session.controller · session.service   ← V2
│                 dto/ (create-session.dto · close-session.dto)
├── daily-recap/  daily-recap.module · daily-recap.service · daily-recap.cron   ← V2
├── eco-calendar/ eco-calendar.module · eco-calendar.controller · eco-calendar.service   ← V2
│                 eco-calendar.cron.ts
├── users/        users.module · users.service
├── vps/          vps.module · vps.controller · vps.service
│                 docker.controller · docker.service
│                 backup.controller · backup.service
│                 logs.controller · logs.service
└── admin/        admin.module · admin.controller
src/common/
├── guards/        jwt-auth.guard · premium.guard · beta.guard   ← BetaGuard V2
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

GET    /api/trades                     ?page&limit&side&setup&emotion&dateFrom&dateTo
POST   /api/trades                     → vérifier limite 30/mois FREE avant création
PATCH  /api/trades/:id
DELETE /api/trades/:id

GET    /api/analytics/summary                    FREE + PREMIUM (pas de PremiumGuard). ?from&to = periode glissante du dashboard (sans bornes = tout l'historique)
GET    /api/analytics/by-setup                   PREMIUM
GET    /api/analytics/by-emotion                 PREMIUM
GET    /api/analytics/by-hour                    PREMIUM
GET    /api/analytics/equity-curve               PREMIUM
GET    /api/analytics/equity-curve/current-month FREE (carte equite dashboard, legacy)
GET    /api/analytics/equity-curve/daily         FREE, ?from&to → carte equite scopee periode
GET    /api/analytics/activity/range             FREE, ?from&to → P&L par jour du dashboard (agregation jour/semaine/mois cote front)
GET    /api/analytics/activity/current-month     FREE (activite mensuelle)
GET    /api/analytics/activity/:year/:month      PREMIUM
GET    /api/analytics/top-assets                 PREMIUM
GET    /api/analytics/daily-recap/yesterday      JWT → recap de la veille

POST   /api/session/start              JWT → démarrer une session, { mood: MoodState }
GET    /api/session/active             JWT → session active en cours (null si aucune)
POST   /api/session/:id/close          JWT → clôturer, { mood: MoodState, notes? }
GET    /api/session/today/trades       JWT → trades du jour
GET    /api/session/today/stats        JWT → stats live (totalPnl, winRate, tradesCount, trades)
POST   /api/session/trades/:id/close   JWT → clôturer un trade (exitPrice → détection SL/TP/Manuel)

GET    /api/eco-calendar/today         PREMIUM → events du jour + analyse IA (cache Redis 1h)
POST   /api/eco-calendar/analyze-result PREMIUM → analyse d'un résultat tombé en temps réel

POST   /api/ai/insights                PREMIUM → cooldown 4h par user
POST   /api/ai/chat                    PREMIUM → 50 messages/jour par user

POST   /api/trades/import              PREMIUM → CSV parsing via Claude SDK
GET    /api/analytics/instruments      instruments avec tickSize/tickValue

GET    /api/debrief/current            PREMIUM
GET    /api/debrief/:year/:week        PREMIUM
GET    /api/debrief/:year/:week/pdf    PREMIUM → export PDF via puppeteer
GET    /api/debrief/history            PREMIUM
POST   /api/debrief/generate           PREMIUM → 1/jour par user

GET    /api/vps/stats                  ADMIN → stats système SSH
POST   /api/vps/apt-update             ADMIN → SSE stream
POST   /api/vps/reboot                 ADMIN → confirmation requise
GET    /api/docker/containers          ADMIN
POST   /api/docker/containers/:id/start|stop|restart   ADMIN
DELETE /api/docker/containers/:id      ADMIN
GET    /api/vps/backups                ADMIN
POST   /api/vps/backups                ADMIN → pg_dump via SSH
GET    /api/vps/logs/:container        ADMIN → SSE stream docker logs
GET    /api/admin/ai-usage             ADMIN → stats tokens/coût
GET    /api/users/admin/:id/detail     ADMIN → fiche utilisateur complète
GET    /api/users/admin/subscriptions  ADMIN → liste abonnements Premium

GET    /api/health
POST   /api/test/upgrade-user          NODE_ENV=test uniquement
```

---

## Règles obligatoires

- **Stats de trades = helper unique** (PROMPT-160) : `computeTradeStats(trades)` de
  `common/utils/trade-stats.util.ts` (`{ total, closed, wins, losses, breakeven, winRate, totalPnl }`).
  Toute mesure win/loss/win rate/P&L d'un lot de trades passe par lui — **jamais** de
  `filter(t => t.pnl > 0)` suivi d'une division inline. Règle break-even : win `pnl > ε`,
  loss `pnl < -ε`, BE `|pnl| <= ε` (`ε` défaut 0) ; **win rate = wins / (wins + losses)** (BE exclus du
  dénominateur) ; trades ouverts (pnl null) hors calcul. Miroir front : `core/utils/trade-stats.util.ts`.
- **Filtre journal « émotion effective »** (PROMPT-166) : l'émotion effective d'un trade =
  `trade.emotion` (override) `??` `tradeSession.moodStart` (humeur de session). Filtrer dessus dans
  `buildTradeWhere` = un **`OR` Prisma** sur les deux sources — `[{ emotion: V }, { emotion: null,
  tradeSession: { moodStart: V } }]`. Ne générer une branche que si `V` appartient à l'enum concerné
  (`Object.values(EmotionState/MoodState).includes(V)`), sinon Prisma throw sur enum invalide :
  `TIRED` → MoodState seul (2ᵉ branche), `REVENGE`/`FEAR` → EmotionState seul (1ʳᵉ branche).
  `NONE` = `{ emotion: null, OR: [{ sessionId: null }, { tradeSession: { moodStart: null } }] }`.
  Filtre `result` : réutiliser le **même `ε`** (`BREAKEVEN_EPSILON`) que `trade-stats.util`, jamais un
  seuil local. **Mêmes filtres appliqués à la liste ET aux stats** (`buildTradeWhere` factorisé) sinon
  les KPIs mentent.
- **Ambassadeur = `role === 'AMBASSADOR'`, JAMAIS « a un referralCode »** (PROMPT-176).
  `User.referralCode` est **partagé** entre les deux parrainages : un USER qui génère
  son code en a un **sans** être ambassadeur. Tout filtre/compteur basé sur la présence
  d'un code est faux (le bug : Lucas le compte démo et un BETA_TESTER remontaient dans
  la liste admin). Corollaire : un `AMBASSADOR` doit **toujours** avoir un code — les
  changements de rôle passent par `AmbassadorService.promote()` / `revoke()`, jamais par
  un `user.update({ data: { role } })` direct. `UsersService.setRole` y délègue.
  Backfill : `scripts/backfill-ambassador-codes.ts` (idempotent).
- **Règle de coexistence du parrainage** : c'est le **rôle du parrain** qui décide, dans
  `processReferral` (`stripe.service.ts`). Parrain `AMBASSADOR` → commission cash 20 %
  (`ReferralCommission`), **jamais** de mois offert. Parrain `USER` → mois offert
  (`ReferralReward`) + coupon filleul au checkout, **jamais** les 20 %. Auto-parrainage
  ignoré. Couvert par `stripe-referral.service.spec.ts` (unitaire) et
  `referral-coexistence.int-spec.ts` (intégration, vraie stack).
- `@UseGuards(JwtAuthGuard)` sur toutes les routes protégées
- `@UseGuards(PremiumGuard)` sur routes IA et analytics avancés
- `@UseGuards(JwtAuthGuard, AdminGuard)` sur TOUTES les routes `/vps/*`, `/docker/*`, `/admin/*`
- `@UseGuards(JwtAuthGuard, BetaGuard)` sur routes V2 session mode (BETA_TESTER + ADMIN)
- `/api/analytics/summary` : PAS de PremiumGuard (FREE y accède)
- `ValidationPipe` global : `whitelist: true, forbidNonWhitelisted: true`
- Ne jamais appeler Prisma dans les controllers
- Ne jamais `console.log` → Logger NestJS
- Argon2 pour les mots de passe (jamais Bcrypt)
- JWT : access_token 15min, refresh_token 7j httpOnly cookie
- SSH credentials uniquement via variables d'env — jamais en dur, jamais en BDD
  - `VPS_HOST=51.83.197.230`, `VPS_USER=greg`, `VPS_SSH_KEY_B64=<base64>`

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

## Style des textes générés : pas de tiret cadratin (PROMPT-174)

Le tiret cadratin (U+2014) et le demi-cadratin (U+2013) ont été retirés de toute
l'interface : ils se lisent comme une marque de texte généré par IA. Les sorties du
modèle sont lues par l'utilisateur (debrief, patterns, conseils, chat, recap 17h30,
analyses éco, news traduites) : elles ne doivent pas les réintroduire.

**Règle unique** : `NO_EM_DASH_RULE` dans `modules/ai/prompts/style.prompt.ts`.
Tout nouveau prompt dont la sortie est affichée à l'utilisateur doit l'injecter :

```typescript
import { NO_EM_DASH_RULE } from '../prompts/style.prompt';

const MON_SYSTEM = `Tu es …
${NO_EM_DASH_RULE}
Format JSON : { … }`;
```

- Prompt avec bloc `system:` → l'injecter dans le système.
- Prompt sans bloc `system:` (message user seul) → l'injecter dans le prompt user.
- Prompt à sortie **structurée non rédactionnelle** (extraction CSV) → inutile.
- Les 2 caractères sont écrits en **échappement unicode** dans la constante
  (`\u2014` / `\u2013`) : le modèle reçoit le caractère réel, et le contrôle
  `grep -rnP "\x{2014}|\x{2013}" apps/*/src | grep -v spec` reste **vide**.
  Ne jamais les réécrire en littéral.

### Où vivent réellement les prompts

`modules/ai/prompts/` ne contient que `debrief.prompt.ts` et `style.prompt.ts`.
Les autres prompts sont **au plus près de leur agent** :

| Sortie | Prompt | Fichier |
|---|---|---|
| Weekly Debrief | `DEBRIEF_SYSTEM_PROMPT` | `prompts/debrief.prompt.ts` |
| Patterns (IA Insights) | `PATTERN_SYSTEM` | `agents/pattern.agent.ts` |
| Conseils (IA Insights) | `COACH_SYSTEM` | `agents/coach.agent.ts` |
| Chat coach | `CHAT_SYSTEM` (inline) | `ai.service.ts` |
| Recap 17h30 | system inline | `ai.service.ts` |
| Analyses éco | prompt user | `ai.service.ts` |
| Traductions news | prompt user | `trades/market-data.service.ts` |

`CHAT_SYSTEM` est **volontairement inline** et non extrait en constante : il interpole
le profil du trader (`${userContext}`), impossible depuis une constante de module.
C'est la raison pour laquelle l'ancien `prompts/insights.prompt.ts` (1ʳᵉ génération,
pré-multi-agents) a été débranché le 2026-04-27 puis **supprimé** : il est resté 3 mois
en code mort, invisible au compilateur car entièrement `export` (TS/ESLint ne signalent
pas les exports inutilisés). Le relire donnait l'illusion de modifier le chat.

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

- Clustering activé uniquement en `NODE_ENV=production`. Nombre de workers = `availableParallelism()` (cœurs CPU dispo ; 8 sur le VPS actuel) — pas une valeur fixe
- `IS_CRON_WORKER=true` sur 1 seul worker → seul lui exécute `@Cron`
- `ScheduleModule.forRoot()` conditionnel dans `app.module.ts` :
  ```typescript
  ...(process.env['IS_CRON_WORKER'] !== 'false' ? [ScheduleModule.forRoot()] : [])
  ```
- En dev : process unique, pas de clustering, IS_CRON_WORKER non défini → crons actifs normalement
- **WebSocket en cluster** : broadcast cross-worker via `@socket.io/redis-adapter` (`RedisIoAdapter` branché au bootstrap dans `main.ts`) — obligatoire en cluster, sinon les emits n'atteignent que les clients connectés au même worker

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

## AiService — logging automatique obligatoire

Après CHAQUE appel Anthropic dans `AiService`, logger la consommation :

```typescript
await this.prisma.aiUsageLog.create({
  data: {
    userId: options.userId,
    feature: options.feature ?? 'unknown',
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    costUsd: (response.usage.input_tokens * 3 + response.usage.output_tokens * 15) / 1_000_000,
  },
});
```

Toujours passer `{ userId, feature }` dans les options. Features valides :
`'insights'` | `'chat'` | `'debrief'` | `'csv_import'` | `'daily_recap'` | `'eco_calendar'`

### Crons V2

| Cron | Planning | Rôle |
|---|---|---|
| `DailyRecapCron` | `30 17 * * 1-5` Paris | Génère recap + envoie email aux users actifs du jour |
| `EcoCalendarCron` | `0 7 * * 1-5` Paris | Pré-génère le calendrier pour tous les users Premium |
| `DemoSeedCron` | `20 3 * * *` Paris | Re-seed le compte démo (dates relatives recalculées) |

### Compte démo : le seed doit rester récurrent (PROMPT-192)

`seedDemo()` génère des dates **relatives au moment du run**. Appelé une seule fois
(endpoint admin), il vieillit en silence : seedée le 2026-06-07, la démo prod affichait
le 2026-08-28 « P&L jour +0$ · Win Rate 0% · 0 trade loggé » et une session active depuis
1978 h, alors que les données live (marché, calendrier, news) étaient pleines — un
prospect voyait un produit vide.

Filets posés par `DemoSeedCron` (`modules/admin/demo-seed.cron.ts`) :
- `@Cron('20 3 * * *')` → re-seed quotidien ;
- `onModuleInit` gardé par `IS_CRON_WORKER === 'true'` (**obligatoire** : sinon les 8
  workers du cluster purgent/recréent le même user en concurrence) → rattrape une API
  restée éteinte plus d'une journée.

Invariants verrouillés par `demo-seed-idempotence.spec.ts` : purge **avant** recréation
et **scopée `userId`** (un re-run remplace, il n'empile pas) · tous les trades dans les
`DEMO_WINDOW_DAYS` (30) derniers jours · J-0 et J-1 peuplés · session du jour ACTIVE ·
P&L total < 15 % du capital et pertes visibles (sobriété AMF : on montre la
fonctionnalité, jamais une performance).

### Comptes de trading de la démo (PROMPT-193)

Le seed créait 56 trades mais **aucun `TradingAccount`** : trades « flottants »
(`accountId` null). Le dashboard lit les trades bruts et affichait un capital plein,
pendant que « Mes comptes » et le sélecteur agrégé, qui passent par les comptes,
affichaient **0 $ / 0 trade / 0 compte**. Deux pages qui se contredisent.

`DEMO_ACCOUNTS` crée 2 comptes ACTIVE et route les trades par actif :
`Éval Futures · 20k` (EVALUATION, Apex, futures purs MNQ/MES/GC) et
`Compte perso · Forex & Crypto` (PERSONAL, EUR/USD + BTC/USDT). Une éval futures qui
loggerait de l'EUR/USD spot ou du BTC n'existe pas — d'où le routage par actif, pas
« tout sur la prop firm ». Deux comptes plutôt qu'un : le multi-comptes est l'une des
ancres Premium (`plans.md`).

**Contrat de cohérence, à ne pas casser** :

```
Σ startingBalance des comptes ACTIVE === PROFILE.startingCapital   (25 000)
```

`dashboard.baseCapital` somme les `startingBalance` **dès qu'un compte existe** et ne
retombe sur `user.startingCapital` que s'il n'y en a aucun ; `accounts.trackedCapital`
fait la même somme. Tout écart et les deux pages divergent à nouveau. Changer un
`startingBalance` impose donc d'ajuster l'autre compte, pas `startingCapital`.

Deux pièges d'ordonnancement :
- **Purger `tradingAccount` APRÈS `trade` et `tradeSession`** : les deux FK sont en
  `onDelete: SetNull`. Purger les comptes en premier détache les lignes au lieu de les
  supprimer — elles survivent au re-seed, orphelines.
- **Aucune session sans compte** : `SessionService.startSession` garantit
  « anti-NULL, jamais de session sans compte ». Les sessions démo portent donc un
  `accountId` (le compte futures), sinon la démo ne reflète pas l'app réelle.

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
  @IsString() @IsNotEmpty() setupId: string;   // setup défini par l'user (table Setup) — plus d'enum
  @IsEnum(TradingSession) session: TradingSession;
  @IsString() timeframe: string;
  @IsOptional() @IsString() notes?: string;
}
```
