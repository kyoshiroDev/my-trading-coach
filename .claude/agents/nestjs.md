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

GET    /api/integrations/tradovate/connections                 JWT → état de connexion par compte (jamais de token)
POST   /api/integrations/tradovate/accounts/:accountId/authorize  JWT → { url } + cookie httpOnly de state · body { origin?: 'wizard'|'settings' }
POST   /api/integrations/tradovate/accounts/:accountId/select     JWT → choix du compte Tradovate { externalAccountId }
POST   /api/integrations/tradovate/accounts/:accountId/sync       JWT → synchro manuelle (FREE, pas de cron en V1)
DELETE /api/integrations/tradovate/accounts/:accountId            JWT → déconnexion (tokens supprimés, trades gardés)
GET    /integrations/tradovate/callback   PUBLIC, HORS /api (redirect_uri enregistré) → 1re synchro puis 302 vers l'app

GET    /api/health
POST   /api/test/upgrade-user          NODE_ENV=test uniquement
```

---

## Règles obligatoires

- **Stats de trades = helper unique** (PROMPT-160) : `computeTradeStats(trades)` de
  `@mtc/shared` (`libs/shared/src/trade-stats.ts`, source unique front + back) (`{ total, closed, wins, losses, breakeven, winRate, totalPnl }`).
  Toute mesure win/loss/win rate/P&L d'un lot de trades passe par lui — **jamais** de
  `filter(t => t.pnl > 0)` suivi d'une division inline. Règle break-even : win `pnl > ε`,
  loss `pnl < -ε`, BE `|pnl| <= ε` (`ε` défaut 0) ; **win rate = wins / (wins + losses)** (BE exclus du
  dénominateur) ; trades ouverts (pnl null) hors calcul. Le front importe le MÊME helper (`@mtc/shared`).
- **Filtre journal « émotion effective »** (PROMPT-166) : l'émotion effective d'un trade =
  `trade.emotion` (override) `??` `tradeSession.moodStart` (humeur de session). Filtrer dessus dans
  `buildTradeWhere` = un **`OR` Prisma** sur les deux sources — `[{ emotion: V }, { emotion: null,
  tradeSession: { moodStart: V } }]`. Ne générer une branche que si `V` appartient à l'enum concerné
  (`Object.values(EmotionState/MoodState).includes(V)`), sinon Prisma throw sur enum invalide :
  `TIRED` → MoodState seul (2ᵉ branche), `REVENGE`/`FEAR` → EmotionState seul (1ʳᵉ branche).
  `NONE` = `{ emotion: null, OR: [{ sessionId: null }, { tradeSession: { moodStart: null } }] }`.
  Filtre `result` : réutiliser le **même `ε`** (`BREAKEVEN_EPSILON`, `@mtc/shared`), jamais un
  seuil local. **Mêmes filtres appliqués à la liste ET aux stats** (`buildTradeWhere` factorisé) sinon
  les KPIs mentent.
- **`effectiveEmotion` sur TOUTE réponse portant un trade** (PROMPT-200). Le champ est
  calculé, pas stocké : chaque endpoint qui renvoie un trade doit inclure
  `tradeSession: { select: { moodStart: true } }` **et** poser
  `effectiveEmotion: effectiveEmotion(t)`. `findAll` le faisait, `create`/`update` non :
  le front remplace l'objet en store par la réponse, donc un champ absent **écrasait**
  la valeur affichée et l'UI retombait sur « non renseignée » jusqu'au rechargement
  (retour Nath). Dans `update`, le calcul va **après** le bloc de recalcul d'exécution,
  qui réécrit `result`. Piège de test : un double Prisma renvoie `tradeSession` quel que
  soit l'`include` — un test qui ne vérifie que la valeur passe au vert avec le bug
  intact. Vérifier l'`include` lui-même.
- **Ambassadeur = `role === 'AMBASSADOR'`, JAMAIS « a un referralCode »** (PROMPT-176).
  `User.referralCode` est **partagé** entre les deux parrainages : un USER qui génère
  son code en a un **sans** être ambassadeur. Tout filtre/compteur basé sur la présence
  d'un code est faux (le bug : Lucas le compte démo et un BETA_TESTER remontaient dans
  la liste admin). Corollaire : un `AMBASSADOR` doit **toujours** avoir un code — les
  changements de rôle passent par `AmbassadorService.promote()` / `revoke()`, jamais par
  un `user.update({ data: { role } })` direct. `UsersService.setRole` y délègue.
  Backfill : `scripts/backfill-ambassador-codes.ts` (idempotent).
- **Règle de coexistence du parrainage** : c'est le **rôle du parrain** qui décide, dans
  `processReferral` (`stripe-referral.service.ts`). Parrain `AMBASSADOR` → commission cash 20 %
  (`ReferralCommission`), **jamais** de mois offert. Parrain `USER` → mois offert
  (`ReferralReward`) + coupon filleul au checkout, **jamais** les 20 %. Auto-parrainage
  ignoré. Couvert par `stripe-referral.service.spec.ts` (unitaire) et
  `referral-coexistence.int-spec.ts` (intégration, vraie stack).
- **Module Stripe** (`modules/stripe/`), un service par responsabilité, tous sur le même
  client injecté `STRIPE_CLIENT` (`stripe.client.ts`, version d'API épinglée) :
  `StripeBillingService` (routes /billing : statut en cache Redis, checkout, portail) ·
  `StripeWebhookService` (signature + idempotence + enqueue, puis un handler par type
  d'événement) · `StripeSubscriptionService` (synchro DB ← Stripe, cache, liste admin) ·
  `StripeReferralService` (commission / mois offert) · `StripeCustomerService` (customer
  sans doublon, avoir) · `StripeCouponService` (coupons filleul). Nouvel événement webhook
  = un `case` + un handler privé dans `StripeWebhookService`. Dans les specs, passer un
  mock Stripe au constructeur ; ne pas réassigner un champ privé.
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
| `TradovateTokenRefreshCron` | `17 */6 * * *` Paris | Renouvelle les tokens Tradovate qui expirent sous 18 h (aucun import de trades, hors démo) |

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
fonctionnalité, jamais une performance). Le capital n'y est **jamais en dur** : les tests
le relisent depuis l'upsert du seed, sinon chaque rééquilibrage (25 000 → 55 000) fausse
silencieusement le ratio au lieu d'échouer.

### Comptes de trading de la démo (PROMPT-193)

Le seed créait 56 trades mais **aucun `TradingAccount`** : trades « flottants »
(`accountId` null). Le dashboard lit les trades bruts et affichait un capital plein,
pendant que « Mes comptes » et le sélecteur agrégé, qui passent par les comptes,
affichaient **0 $ / 0 trade / 0 compte**. Deux pages qui se contredisent.

`DEMO_ACCOUNTS` crée 2 comptes ACTIVE et route les trades par actif :
`Apex 50k · Éval` (EVALUATION, futures purs MNQ/MES/GC) et
`Compte perso · Forex & Crypto` (PERSONAL, EUR/USD + BTC/USDT). Une éval futures qui
loggerait de l'EUR/USD spot ou du BTC n'existe pas — d'où le routage par actif, pas
« tout sur la prop firm ». Deux comptes plutôt qu'un : le multi-comptes est l'une des
ancres Premium (`plans.md`).

**Règles prop firm : de vraies valeurs, jamais un palier inventé** (PROMPT-195).
Le compte porte les règles réelles Apex 50k Full Evaluation — base 50 000, objectif
+3 000, trailing drawdown 2 500. L'itération précédente utilisait un 20k générique que
*aucune* firme ne propose : un prospect qui connaît le marché le repérait. Si un jour on
change de firme ou de palier, reprendre des valeurs réelles, ou revenir à un libellé
sans marque — mais pas une marque sur un palier fictif.

**Ce que la démo n'affirme pas** : renseigner les règles de la firme n'est pas prétendre
reproduire son calcul officiel. L'app estime marge et pacing depuis les seuls trades
loggés — pas de trailing intraday, pas de positions ouvertes, pas de fuseau. C'est déjà
porté par `RULE_DISCLAIMER` (`accounts.service`) et la clause conformité du
`DEBRIEF_SYSTEM_PROMPT` : ne rien écrire dans la démo qui les contredise. L'éval doit
aussi rester **en cours** (P&L < objectif) et loin du seuil de liquidation — une éval
déjà passée se lirait comme une promesse de réussite.

**Contrat de cohérence, à ne pas casser** :

```
Σ startingBalance des comptes ACTIVE === PROFILE.startingCapital   (50 000 + 5 000 = 55 000)
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

---

## Synchro broker par API — pattern (PROMPT-207, Tradovate / NinjaTrader)

Premier broker synchronisé par **API** plutôt que par fichier. Module
`modules/integrations/tradovate/`. À reprendre tel quel pour Binance / Bybit.

**Règles réutilisables**
- **Une connexion = un `TradingAccount`** (`BrokerConnection`, `@@unique([accountId, provider])`),
  jamais au niveau `User` : chaque prop firm donne ses propres identifiants. Nouveau broker =
  nouvelle valeur de l'enum `BrokerProvider`, même table.
- **Secrets chiffrés** (`common/utils/token-cipher.util.ts`, AES-256-GCM, clé
  `BROKER_TOKEN_ENCRYPTION_KEY`), jamais renvoyés : les vues publiques (`toView`) excluent
  toute colonne `*Enc`. Pour une clé API Binance : même colonnes, même chiffrement.
- **Mapper PUR** (`tradovate-trade.mapper.ts`) : entités broker → `Partial<CreateTradeDto>`,
  sans I/O, testé unitairement. Puis **`TradesService.importTrades`** — jamais un
  `trade.create` direct : c'est lui qui porte la dédup `importHash` + contrainte
  d'unicité, le compte cible et le recalcul du barème comportemental.
  **Répétitions ≠ doublons** : deux lignes identiques d'une même source (fichier, synchro) sont
  deux trades — un trade à plusieurs contrats arrive souvent en plusieurs paires Tradovate de
  mêmes prix et même seconde de clôture. La n-ième prend l'empreinte `clé#n` (`occurrenceHash`) :
  réimporter la source ne recrée rien, une répétition manquante en base est créée. Le nettoyage
  des doublons (`GET/DELETE /trades/duplicates`) raisonne sur `importHash ?? clé` pour ne jamais
  supprimer une répétition légitime, et `isCrossSourceDuplicate` (fuseau CSV) exclut l'écart nul
  et consomme un trade existant par paire. Avant ce correctif, 5 des 28 paires de Val (14/09/2026)
  étaient écartées comme doublons. Un trade API doit avoir
  EXACTEMENT la forme d'un trade CSV du même broker (règles partagées dans
  `trades/tradovate-pair.util.ts`, utilisées par les DEUX chemins).
- **Client HTTP en lecture seule** (`tradovate-api.client.ts`) : que des GET de données + les
  appels d'auth. Aucune méthode d'écriture (ordre, risque) — contrat NinjaTrader.
- **Erreurs** : `TradovateException(code)` → message FR clair + `code` machine (relayé par
  `HttpExceptionFilter`, qui transmet désormais `code` s'il est présent). Jamais de réponse
  brute du broker, jamais de stack. **Aucun autre broker nommé** dans ces messages (clause 2.ii).
- **Verrou Redis** par connexion pendant la synchro (double-clic) ; Redis down → on continue,
  la contrainte d'unicité reste le filet.
- **Pas de PremiumGuard** : même règle que l'import CSV d'un broker connu (cf. `plans.md`).

**Spécificités Tradovate (vérifiées)**
- OAuth **toujours sur Live** (`trader.tradovate.com/oauth`, `live.tradovateapi.com/auth/oauthtoken`,
  échange en `x-www-form-urlencoded`). Les **données** sont sur 2 hôtes : `live` (comptes réels)
  et `demo` (comptes simulés = comptes de prop firm). `account/list` est interrogé sur les deux,
  l'hôte est mémorisé par compte (`externalEnv`).
- Le token endpoint renvoie un **`refresh_token`** (non documenté) : renouvellement 5 min avant
  expiration (≈ 80 min) par `grant_type=refresh_token`, repli `GET /auth/renewaccesstoken`, sinon
  `NEEDS_RECONNECT` (409 `TRADOVATE_RECONNECT_REQUIRED`). Jamais de consentement toutes les 80 min.
- **Mesuré en beta** : le grant `refresh_token` fonctionne, et Tradovate **fait tourner** le
  refresh_token (nouveau à chaque renouvellement, durée ≈ **26 h**, fenêtre glissante). La
  synchro étant manuelle, `TradovateTokenRefreshCron` maintient les connexions : toutes les 6 h,
  celles qui expirent sous 18 h (≈ un renouvellement / 12 h, 2 passages manqués couverts).
  `refreshNow` : refus → `NEEDS_RECONNECT` ; panne / limite → reporté, connexion intacte.
- **Verrou partagé synchro + cron** (`tryLock` / `unlock` du service de connexion, clé
  `tradovate:sync:<id>`) : deux renouvellements concurrents présenteraient un refresh_token
  déjà remplacé et marqueraient à tort la connexion « à reconnecter ».
- **Callback hors `/api`** (exclu dans `main.ts`) : le redirect_uri enregistré est
  `https://<api>/integrations/tradovate/callback`. Ne pas le déplacer sans mettre à jour
  l'inscription OAuth côté Tradovate.
- **`state` signé + cookie httpOnly** (`mtc_tradovate_oauth`, SameSite=Lax, path du callback).
  Le cookie est **obligatoire** au callback : sans lui, un tiers pourrait faire consentir une
  victime avec SON lien et recevoir les trades de la victime. La doc ne dit pas si Tradovate
  renvoie `state` : s'il le renvoie, il doit égaler le cookie. Côté front, l'appel `authorize`
  doit partir **avec credentials** pour que le cookie soit posé.
- **Retour au point de départ** (PROMPT-208) : l'origine (`wizard` | `settings`) est signée
  dans le `state`. Le callback lance une **première synchro** (jamais bloquante : échec →
  `sync=error`, la connexion reste faite) puis redirige : wizard → `/dashboard?…&from=wizard`
  (l'overlay d'onboarding s'y rouvre), réglages → `/accounts?…`. Query params : `tradovate`
  (`connected`|`select_account`|`error`), `accountId`, `reason`, `trades`, `fees`
  (`ok`|`partial`|`none`), `sync`, `from`. Un `state` illisible renvoie vers les réglages,
  jamais sur une page morte.
- Chaîne de lecture : `position/list` (seul lien fill → compte) → `fillPair/list` (paires =
  lignes de l'export Performance) → `fill/list` + `fillFee/list` (fills et frais exacts de la
  séance, filtrés sur les paires ; un id absent est relu par `fill/items` / `fillFee/items`)
  → `contract` / `contractMaturity` / `product` (symbole, `valuePerPoint`).
- ⚠ **Lots `/xxx/items` : 10 ids maximum.** Au-delà, Tradovate répond 404 à corps vide alors que
  chaque entité existe (mesuré sur le compte de Val le 14/09/2026 : 1, 2 et 10 ids passent,
  41 → 404). À 100 par lot, la synchro d'un compte actif échouait entièrement. Un fill
  introuvable n'ignore que sa paire (`skipped`), jamais toute la synchro.
- **Un 404 de lecture n'est pas « compte introuvable »** : `TradovateApiError('not_found')`
  → `TRADOVATE_UNAVAILABLE`. Seule l'absence du compte dans `account/list` (synchro, choix du
  compte) lève `TRADOVATE_ACCOUNT_NOT_FOUND`, qui invite à reconnecter.
- P&L = **brut** `(vente − achat) × qty × valuePerPoint`, frais dans `commission` (comme le CSV).
  `tradedAt` tronqué à la seconde (granularité de l'export).
- **Rapprochement CSV ↔ API** : l'export Performance est en heure LOCALE sans fuseau, parsée
  dans le fuseau du serveur (`TZ=Europe/Paris` en beta). L'empreinte exacte ne coïncide donc
  pas ; `isCrossSourceDuplicate` reconnaît le même trade décalé d'un nombre entier de
  demi-heures (≤ 14 h), mêmes prix, même P&L.
- ⚠ **Profondeur d'historique non garantie** : l'API REST pourrait ne renvoyer que les
  positions / paires récentes. À mesurer en beta sur un vrai compte ; si c'est le cas, un
  import CSV reste nécessaire pour le passé et la synchro sert au fil de l'eau.
  (Vérifié : la synchro n'envoie AUCUNE borne de date — `position/list` et `fillPair/list` n'ont
  pas de paramètre ; test « première synchro : tout l'historique » dans `tradovate-sync.int-spec`.)
  **Mesuré le 2026-09-12 (samedi, PROMPT-212)** : sur 2 logins réels (4 comptes prop firm),
  `position/list`, `fillPair/list`, `fill/list` et `order/list` renvoient 0 entité alors que
  l'utilisateur avait tradé avant la connexion → très probablement, ces routes n'exposent que la
  séance en cours. À confirmer un jour de bourse. Chaque synchro logue désormais ce que Tradovate
  a RENVOYÉ (`describeTradovateSnapshot` : comptes, positions du compte / des autres comptes du
  login, séances, paires rattachées ou orphelines, fills lus) — jamais de prix ni de P&L.

**Temps réel (PROMPT-210 live) — calé sur la PRÉSENCE dans l'app**
- Canal applicatif `/tradovate-live` (`tradovate-live.gateway.ts`, même pattern que `/eco`) mais
  **authentifié** : JWT de l'app dans `handshake.auth.token`, vérifié par `JwtService`
  (`AuthModule` importé) ; invalide ou `isDemo` → `disconnect(true)`. Room `user:<id>`.
- `TradovateLiveService` : 1er client d'un user sur le worker → **rattrapage REST** (la synchro
  existante, sautée si `lastSyncAt` < 60 s) puis **un WebSocket Tradovate par compte connecté**.
  Dernier client parti → WebSockets fermés (1000). Rien ne tourne app fermée.
- **Un seul WebSocket par user, tous workers et onglets confondus** : bail Redis
  `tradovate:live:<userId>` (SET NX PX 30 s, renouvelé / rendu par script Lua « si c'est le
  mien »). Worker titulaire sans clients → il rend le bail, un autre reprend ≤ 10 s. Redis down →
  on laisse passer (au pire 1 WS par worker). `isLive(userId)` = le bail existe.
- `tradovate-live.connection.ts` : `authorize\n0\n\n<token>` (même access_token que le REST,
  pris **sous le verrou `tradovate:sync:<id>`** : rotation du refresh_token), puis
  `user/syncrequest` `{ accounts: [id], entityTypes: ['fill','fillPair','position'] }`
  (`entityTypes` obligatoire), heartbeat `[]` / 2,5 s. Coupure → backoff 1 s → 60 s ;
  `shutdown ConnectionQuotaReached` → 5 min ; jeton irrécupérable → abandon + événement
  `tradovate:status` (le bouton manuel reste le filet).
- **Aucun trade créé depuis l'événement** : `props` utile → regroupement 1,5 s →
  `TradovateSyncService.sync` (mapper, frais, dédup, verrou). `SYNC_IN_PROGRESS` → 3 essais / 3 s.
  Trades créés → `tradovate:trades { accountId, created, duplicates, total, source }`.
- Hôtes WS : `wss://{live|demo}.tradovateapi.com/v1/websocket` (même hôte que le REST du compte ;
  la doc NinjaTrader écrit `tradovateapi.com` sans `live.` pour le réel — à confirmer au 1er
  compte réel). WebSocket natif Node 22 (`LIVE_SOCKET_FACTORY`, remplacé en test).
- **Limites documentées** : 50 connexions WebSocket simultanées **par user Tradovate**, 15
  appareils, `shutdown ConnectionQuotaReached`. **Aucune limite par `cid` / application
  documentée** → à confirmer avec NinjaTrader avant la montée en charge prod (pas bloquant à
  2-3 users de test).
- Filet de fond `TradovateBackgroundRefreshCron` (`7,37 * * * *` Paris, worker cron) : connexions
  sans synchro depuis 25 min, **users dont l'app est ouverte sautés** (le WebSocket s'en charge),
  démo exclus. Sert le récap journalier / Weekly Debrief, jamais le temps réel.
- Limite connue : un compte connecté PENDANT que l'app est ouverte n'est suivi en direct qu'à la
  prochaine ouverture (liste des connexions lue à l'arrivée du 1er client).

## Librairie partagée `@mtc/shared` (étape 3 de l'audit, 2026-09-13)

- `libs/shared/src` : code PUR commun à l'API, l'app et l'admin (aucune dépendance, aucun effet
  de bord). Aujourd'hui : `computeTradeStats` / `classifyTrade` (règle du win rate) et les valeurs
  tarifaires (`PREMIUM_PRICE_EUR`, `TRIAL_PERIOD_DAYS`, `ACCOUNT_LIMITS`,
  `PREMIUM_ANNUAL_SAVINGS_EUR`). Import : `from '@mtc/shared'`.
- Branchement côté API (3 endroits, tous nécessaires) :
  - `tsconfig.app.json` : `paths` + la lib dans `include` (projet `composite`) + `rootDir: ../..` ;
  - `webpack.config.js` : alias posé dans le hook `NodeModulesExternalsPlugin` (le plugin paths de
    Nx ne lit pas nos `paths`) ET `@mtc/*` exclu des externals — sinon `require('@mtc/shared')`
    au démarrage, introuvable dans node_modules ;
  - `vitest.config.ts` et `vitest.integration.config.ts` : `resolve.alias`.
- Ré-exporter une valeur de la lib : `export { X } from '@mtc/shared'` — jamais un import suivi de
  `export { X }`, effacé par la transpilation fichier par fichier (webpack : « export not found »).
- Pas de `tsconfig` dans `libs/shared` (volontaire) : le plugin TS de Nx y ajouterait des cibles et
  `nx sync` (lancé dans le Dockerfile) réécrirait les références TS.
- Types d'API front/back (27 noms en double) : PAS encore partagés — les dates y sont `Date` côté
  API et `string` côté front (JSON) ; à traiter avec un type de transport dédié.

## Import CSV : parseurs purs (étape 4 de l'audit, 2026-09-13)

- `trades/csv-parsers.ts` : détection du broker, normalisation au CSV pivot (Tradovate, Binance
  futures/spot, Bybit, IBKR, MEXC, MT4/MT5), séparateur européen, `splitCsvLine`,
  `mapNormalizedCsvToDto`, `detectSession`, et les types `BrokerType` / `ImportDto`. Fonctions
  PURES : aucun service injecté, testables directement (`csv-import.service.spec.ts` les importe).
- `CsvImportService` (≈ 570 lignes au lieu de 1 120) garde l'orchestration : plan / accès IA,
  formats inconnus via Claude, fusion des frais Tradovate, persistance.
- Nouveau broker = une fonction `parseXxx(lines)` dans `csv-parsers.ts` + un cas dans
  `detectBroker` / `preprocessCsv` — pas de nouvelle méthode dans le service.
