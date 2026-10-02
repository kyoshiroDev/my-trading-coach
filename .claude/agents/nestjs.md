---
name: nestjs
description: "Conventions de l'API NestJS : modules, routes, guards, DTO, erreurs, IA, crons. À lire avant tout travail dans apps/api-mytradingcoach."
---

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
GET    /api/instruments                JWT → futures CME + crypto (InstrumentsController)
GET    /api/instruments/search?q=      JWT → FMP, puis liste statique, puis crypto (10 max)
GET|PATCH /api/instruments/user-assets JWT · PATCH /api/instruments/favorite-asset
GET    /api/market/context             JWT (FREE, IA mutualisée) → DXY, taux, indices (MarketController)
GET    /api/market/news?symbols=       JWT (FREE) · GET /api/market/news/:id/text (traduction paresseuse)
GET    /api/market/live-price?symbol=  JWT (FREE) → trade rapide
  (TradesController ne gère que les trades ; ses anciennes routes market/instruments sont @DeprecatedRoute)

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
GET    /api/admin/ai-cost              ADMIN → coût IA 30 j (réel + estimé)
GET    /api/admin/users                ADMIN → liste (?page&limit&search)   ┐
GET    /api/admin/users/stats          ADMIN → KPIs (MRR, inscrits, essais) │ AdminUsersController
GET    /api/admin/users/online         ADMIN                                │ (littéraux AVANT :id)
GET    /api/admin/users/subscriptions  ADMIN → abonnements                  │
GET    /api/admin/users/:id            ADMIN → fiche utilisateur complète   │
PATCH  /api/admin/users/:id(/role)     ADMIN · DELETE /api/admin/users/:id  ┘
GET    /api/admin/ambassadors          ADMIN → liste                        ┐
GET    /api/admin/ambassadors/:id/stats ADMIN                               │ AdminAmbassadorsController
PATCH  /api/admin/ambassadors/:id/pay-all ADMIN                             │
POST   /api/admin/ambassadors/promote|revoke ADMIN                          │
GET    /api/admin/referral/overview    ADMIN                                ┘

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
- **P&L = NET partout, via `netPnl`** (PROMPT-213) : `Trade.pnl` est stocké BRUT, les frais dans
  `commission`. `computeTradeStats` classe et somme sur `netPnl(t)` = `pnl − |commission|` : **toute
  requête Prisma qui alimente une stat sélectionne `commission` avec `pnl`** (sinon le calcul retombe
  sur le brut sans erreur). Même règle pour les agrégats écrits à la main (analytics : drawdown,
  profit factor, série, par setup/émotion/heure, courbe, calendrier, top actifs ; session ; débrief ;
  récap et agents IA). Seule exception assumée : la note d'exécution (`execution-grade.util`).
  `AnalyticsService` passe par son helper local `net(t)`. `SetupStat.avgRR` vaut `null` (pas 0)
  quand aucun trade du setup n'a de R:R.
- **Borne haute des périodes analytics** : un `to` date seule (`2026-09-14`) couvre la journée
  entière (`AnalyticsController.endBound`) ; lu tel quel il valait minuit et excluait les trades du jour.
- **Setup des trades importés = « Sans setup »** (PROMPT-213) : la synchro broker, l'import CSV sans
  setup choisi et le repli d'un `setupId` périmé (`resolveBatchSetupId`) passent par
  `SetupsService.getImportSetupId`, qui trouve ou crée (ou désarchive) le setup `IMPORT_SETUP_TITLE`
  (`#6b7280`, sortOrder 999). Plus de repli sur le premier setup du user (qui rangeait tout en
  « Breakout » et faussait les stats par setup).
- **Devise = propriété DU COMPTE, jamais convertie, jamais globale** (PROMPT-214) :
  `TradingAccount.currency` ∈ `ACCOUNT_CURRENCIES` (`@mtc/shared`, liste unique front + back ;
  DTO create/update : `@Transform(normalizeCurrencyCode)` + `@IsIn`). Compte synchronisé : devise
  **lue chez le broker** par `TradovateConnectionService.resolveAccountCurrency`
  (`/cashBalance/list` → `currencyId` du compte, puis `/currency/item?id=` pour le code), posée à la
  sélection du compte ET à la connexion quand le compte est choisi automatiquement ; **refusée** en
  update (`AccountsService.update`, 400). ⚠️ **`currencyId` est un identifiant INTERNE Tradovate**
  (1 = USD, 2 = EUR…), **pas un code ISO 4217** : jamais de table en dur, toujours `/currency/item`
  (mesuré le 2026-09-20, cf. `docs/tradovate-api-capabilities.md` §2). Lecture best-effort : token
  inexploitable, endpoint indisponible ou devise hors `ACCOUNT_CURRENCIES` (ex. CAD) → repli
  `DEFAULT_ACCOUNT_CURRENCY` + `logger.warn`, jamais d'échec de la sélection de compte. Montants serveur visibles (emails débrief / recap, PDF,
  prompts IA) : `formatMoney` avec la devise du compte, ou `userAmountsCurrency()`
  (`common/utils/user-currency.util.ts` : devise commune des comptes non archivés, `null` si mêlées
  → sans symbole). **Plus aucun taux** : `User.currencyRate` n'est plus lu ni écrit (ni
  exchangerate-api, ni cache). Les champs `currency` des DTO onboarding / préférences sont encore
  ACCEPTÉS mais IGNORÉS (`@deprecated`, pour ne pas rejeter un front en cache avec
  `forbidNonWhitelisted`) : à retirer avec les colonnes (migration séparée, cf. `prisma.md`).
  Seuls `$` en dur tolérés : logs internes (coût Anthropic, réellement en USD).
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
  Backfill : `tools/scripts/backfill/ambassador-codes.ts` (idempotent).
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
- **Route admin = sous `/admin`**, dans un contrôleur gardé AU NIVEAU DE LA CLASSE (`AdminController`,
  `AdminUsersController`, `AdminAmbassadorsController`) : jamais de `@UseGuards(AdminGuard)` route par route
  dans un contrôleur utilisateur. Test : `modules/admin/admin-routes.spec.ts`.
- Déplacer une route : garder l'ancienne une version avec `@DeprecatedRoute('GET /nouvelle')`
  (`common/decorators`) qui journalise un `warn` à chaque appel ; la supprimer quand les logs sont muets.
  En cours : `/users/admin/*`, `/ambassador/list|admin/*|pay-all/*`, `/referral/admin/overview`,
  `/trades/{market-context,news,live-price,instruments,user-assets,favorite-asset}`.
- `@UseGuards(JwtAuthGuard, BetaGuard)` sur routes V2 session mode (BETA_TESTER + ADMIN)
- `/api/analytics/summary` : PAS de PremiumGuard (FREE y accède)
- `ValidationPipe` global : `whitelist: true, forbidNonWhitelisted: true`
- Ne jamais appeler Prisma dans les controllers
- Imports profonds : alias `@api/…` (= `src/`, ex. `@api/common/guards/jwt-auth.guard`), déclaré dans
  `tsconfig.base.json`, `webpack.config.js` et les deux `vitest*.config.mts`
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
    model: AI_MODELS.analysis, // jamais un identifiant en dur : modules/infra/ai-pricing.const.ts
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
  model: AI_MODELS.analysis,
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

- Clustering activé uniquement en `NODE_ENV=production`. Nombre de workers = `WEB_CONCURRENCY`, défaut `min(cœurs, 3)` (`config/web-concurrency.ts`, SCA-B0-02). Le VPS a **4** cœurs. Chaque process a un plafond de tas (`NODE_OPTIONS=--max-old-space-size=384` dans les compose), conteneur à 2 Gio
- `IS_CRON_WORKER=true` sur 1 seul worker → seul lui exécute `@Cron`
- `ScheduleModule.forRoot()` conditionnel dans `app.module.ts`, en **opt-in** :
  ```typescript
  ...(process.env['IS_CRON_WORKER'] === 'true' ? [ScheduleModule.forRoot()] : [])
  ```
- En dev : process unique, pas de clustering. Crons INACTIFS sauf `IS_CRON_WORKER=true` dans `.env`
- Worker mort : relancé avec un délai croissant (1 s → 30 s) ; au-delà de 5 morts en une minute,
  le process principal sort en erreur et Docker redémarre le conteneur (pas de boucle infinie).
- SIGTERM (docker stop) : le principal le transmet aux workers sans les relancer ;
  `app.enableShutdownHooks()` ferme proprement Redis, Prisma et BullMQ.
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
| `TradovateTokenRefreshCron` | `17 * * * *` Paris | Renouvelle les tokens Tradovate qui expirent sous 18 h + seconde chance des « à reconnecter » encore promises (aucun import de trades, hors démo) |
| `TradovateBackgroundRefreshCron` | `*/15 * * * *` Paris | Synchro de fond des connexions sans synchro depuis 12 min (hors démo, hors app ouverte). **Au 1er passage de chaque heure seulement** (minute < 15), ajoute le rattrapage du mois par la Reporting API, et remonte tout le passé (≤ 2 par passage) des connexions dont `historyImportedAt` est vide |

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
`DEMO_WINDOW_DAYS` (42, soit 6 semaines) derniers jours, la vue « 1M » restant pleine · J-0 et
J-1 peuplés · session du jour ACTIVE, démarrée aujourd'hui, **aucun trade après `now`** (même
quand le cron tourne à 03:20 : les trades du jour sont calés avant l'heure du run) ·
P&L total < 15 % du capital et pertes visibles (sobriété AMF : on montre la
fonctionnalité, jamais une performance). Le capital n'y est **jamais en dur** : les tests
le relisent depuis l'upsert du seed, sinon chaque rééquilibrage (25 000 → 55 000) fausse
silencieusement le ratio au lieu d'échouer.

### Comptes de trading de la démo (PROMPT-193)

Le seed créait 56 trades mais **aucun `TradingAccount`** : trades « flottants »
(`accountId` null). Le dashboard lit les trades bruts et affichait un capital plein,
pendant que « Mes comptes » et le sélecteur agrégé, qui passent par les comptes,
affichaient **0 $ / 0 trade / 0 compte**. Deux pages qui se contredisent.

`DEMO_ACCOUNTS` crée 2 comptes prop firm ACTIVE en USD (PROMPT-215) : `Apex 50k · Éval`
(EVALUATION) et `Tradeify 50k · Funded` (FUNDED), **futures d'indices US uniquement**
(MES / MNQ, quelques ES / NQ). Le compte perso Forex & Crypto et l'or ont été retirés : la
démo s'adresse à des traders de futures prop firm. Deux comptes plutôt qu'un : le
multi-comptes est l'une des ancres Premium (`plans.md`).

**Un trader réaliste, pas un gagnant parfait (PROMPT-215, validé par Greg).** `buildDemoDataset(now)`
(pur, sans base) génère ~6 semaines de jours ouvrés, 2 à 4 trades par jour, frais réels
(1,24 $ A/R par micro, 4,50 $ par mini) dans `commission`, `pnl` brut. Puis il cherche,
de façon déterministe, le premier tirage qui respecte `meetsTargets` :
- win rate NET 52-57 % ;
- 35-45 % de journées rouges ;
- brut 1 200-1 800 $, net 650-1 150 $, frais 470-700 $ ;
- setups contrastés : Breakout le meilleur, Reversal perdant, **Scalping positif en brut
  et négatif en net** ;
- éval Apex en cours, drawdown visible mais sous 50 % du seuil ;
- une journée de **revenge trading** : ré-entrées < 2 min, taille doublée, sans stop.

La note d'exécution est calculée comme en prod (barème A par trade, barème B par compte).
Il y a un débrief hebdo par semaine terminée (sections par compte) et un récap par jour de
trading, avec des textes dérivés des vrais chiffres générés. Le texte figé `DEMO_INSIGHTS`
(`ai.service`) y est aligné, en qualitatif : les chiffres varient légèrement selon le jour
du run.

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
Σ startingBalance des comptes ACTIVE === PROFILE.startingCapital   (50 000 + 50 000 = 100 000)
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

> ⚠ **Ne PAS remplacer `CreateTradeDto` par le schéma zod du front** (CT-04 laissée ouverte,
> analyse du 2026-09-27). Le schéma de `app/core/schemas/trade.schema.ts` est écrit pour un
> formulaire, pas pour une API, et il diverge du DTO :
>
> | Champ | DTO | Schéma front |
> |---|---|---|
> | `entry` | optionnel, ≥ 0 | **obligatoire, > 0** |
> | `commission` | présent | **absent** |
> | `accountId` | présent | **absent** |
> | `exit` · `stopLoss` · `takeProfit` | ≥ 0 | > 0 |
> | `asset` · `notes` · `tags` | bornés (40 · 2000 · 20×30) | non bornés |
> | `tradedAt` | `IsDateString` | `string` libre |
>
> `commission` et `accountId` sont écrits par la **synchro broker** et l'**import CSV**. Le
> `ValidationPipe` global tourne en `whitelist: true, forbidNonWhitelisted: true` : un schéma
> incomplet ne les ignorerait pas, il ferait **échouer la requête**. Pour finir CT-04 : partir du
> DTO (plus complet), créer une lib dédiée — `libs/shared` s'interdit toute dépendance externe,
> donc pas de zod dedans — et tester un trade venant de la synchro et un venant d'un CSV.


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
  supprimer une répétition légitime, et le rapprochement « même trade, autre fuseau »
  (`CrossSourcePool`, `trades/import-dedupe.util.ts`) se fait dans `importTrades` : écart nul
  exclu, un trade existant par ligne. Avant ce correctif, 5 des 28 paires de Val (14/09/2026)
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

**Quand les trades sont-ils récupérés ?** (PROMPT-217)

| Déclencheur | Séance en cours (Trade API) | Mois en cours (Reporting API) |
|---|---|---|
| Connexion d'un compte Tradovate | ✅ | ✅ **toute la vie du compte** |
| Ouverture de l'app (`catchUp`) | ✅ si > 1 min | ✅ **si > 30 min d'absence** |
| Trade en direct, app ouverte | ✅ ~1,5 s | ❌ |
| Cron de fond, toutes les 15 min | ✅ si > 12 min | ❌ |
| Cron de fond, 1er passage de l'heure | ✅ (sauf app ouverte) | ✅ **y compris app ouverte** |
| Bouton « Synchroniser » | ✅ | ✅ |
| Cron, 1er passage de l'heure, `historyImportedAt` vide | — | ✅ **toute la vie du compte**, ≤ 2 par passage |

**Profondeur de l'historique = la vie du compte, jamais une constante.** Tradovate date le compte
(`timestamp` sur `/account/list`, servi aussi par `/account/item` — non documenté, vérifié le
2026-09-26 sur 3 comptes prop firm). `depthFromCreation` en déduit le nombre de fenêtres
mensuelles ; l'appel existait déjà pour relire le nom du compte, donc zéro requête de plus.
Conséquences à connaître :

- L'arrêt « 2 mois vides d'affilée » ne s'applique **que** faute de date de création. Avec une
  date, il est désactivé — et ce n'est pas cosmétique : compte mesuré créé le 2026-02-12, premier
  trade en juillet, soit **5 mois vides entre les deux** que l'arrêt rendait inatteignables.
- Sans date exploitable (champ absent, ou postérieure à maintenant) → repli `HISTORY_FALLBACK_MONTHS`
  (6) **et** arrêt aux mois vides : c'est alors la seule borne disponible.
- `HISTORY_MAX_MONTHS` (60) est un garde-fou contre une date aberrante, pas une politique.
- **Une profondeur demandée est un contrat, jamais « corrigée ».** `{ months: 1 }` reste un mois,
  même sur une connexion qui n'a jamais eu son passé : cet appelant, c'est le bouton
  « Synchroniser », donc quelqu'un qui attend. 24 fenêtres = 11 s d'appels mesurés + l'écriture en
  base : un clic de 2 s deviendrait un clic de 30 s. **Une profondeur pleine ne se tire que là où
  personne n'attend** : à la connexion d'un compte (non attendu, `void` dans le callback OAuth) et
  dans le cron de fond.
- **`historyImportedAt` est l'état de ce rattrapage** : vide = le passé n'a jamais été remonté
  entièrement. Le cron (1er passage de l'heure) en traite au plus `FULL_BACKFILLS_PER_PASS` (2),
  ce qui étale un déploiement trouvant N connexions au lieu d'empiler N imports dans un passage et
  de chevaucher le suivant. Le marqueur n'est posé que par un import de profondeur pleine **et**
  si aucune fenêtre n'a échoué — sinon le trou ne serait plus jamais comblé.
- Un mois vide ne coûte qu'**un** appel (pas de rapport `Fills`), donc remonter loin est bon marché.

La raison d'être du rattrapage mensuel : **la Trade API ne montre que la séance ouverte et ne
rejoue JAMAIS une séance passée**. Tout ce qui est tradé pendant que l'API est arrêtée
(déploiement, panne) serait perdu définitivement. Le rapport mensuel, lui, le contient.
D'où aussi le seuil des 30 min à l'ouverture : c'est le filet d'auto-réparation après une panne
du worker cron — il suffit qu'un utilisateur ouvre l'app pour que son mois soit rattrapé.

⚠️ **Le cron saute la SÉANCE d'un utilisateur en direct, jamais son rattrapage mensuel.** Le
WebSocket ne fait que la séance, et le filtre de fraîcheur exclurait toujours un utilisateur
actif : sans traitement particulier, celui qui laisse l'app ouverte toute la journée serait le
SEUL à ne jamais recevoir le filet. Au 1er passage de l'heure, le cron interroge donc TOUTES les
connexions (aucun filtre de fraîcheur) et appelle directement `importForAccount` pour celles qui
sont en direct.

**Spécificités Tradovate (vérifiées)**
- OAuth **toujours sur Live** (`trader.tradovate.com/oauth`, `live.tradovateapi.com/auth/oauthtoken`,
  échange en `x-www-form-urlencoded`). Les **données** sont sur 2 hôtes : `live` (comptes réels)
  et `demo` (comptes simulés = comptes de prop firm). `account/list` est interrogé sur les deux,
  l'hôte est mémorisé par compte (`externalEnv`).
- Le token endpoint renvoie un **`refresh_token`** (non documenté) : renouvellement par
  `grant_type=refresh_token`, repli `GET /auth/renewaccesstoken`, sinon `NEEDS_RECONNECT`
  (409 `TRADOVATE_RECONNECT_REQUIRED`). Jamais de consentement toutes les 80 min.
- **Cycle de vie du token — règles issues du bug prod du 2026-09-21** (4 comptes d'un ambassadeur
  passés à tort en « à reconnecter », plusieurs fois par jour) :
  - **`REFRESH_MARGIN_MS` = 40 min**, pas 5. Le cron de fond passe toutes les **30 min** : une
    marge plus courte que la cadence n'est quasiment jamais dans la fenêtre, le refresh n'était
    donc tenté qu'une fois l'access token **déjà mort**. Or `renewaccesstoken` exige un access
    token vivant : expiré, il n'y a plus de filet. **Règle : marge > cadence du cron de fond.**
  - **Un refus de refresh ne condamne jamais une connexion.** `refreshWithRetry` réessaie une
    fois après 2 s, en **relisant la connexion** (un autre worker du cluster a pu renouveler
    entre-temps : son access token est alors pris tel quel, sans rappeler Tradovate).
    `NEEDS_RECONNECT` n'est posé que si **deux** refus ET repli renew indisponible ou refusé.
  - ⚠️ **`refreshTokenExpiresAt` n'est pas une autorité pour TENTER.** Tradovate annonce ≈ 25 h
    (et non les 14 j de sa doc) puis refuse parfois le token bien avant. On tente dès qu'un refresh
    token existe.
  - **Mais c'est elle qui décide de CONDAMNER** (correctif du 2026-09-26, objectif produit : « connecté
    tant que l'utilisateur ne clique pas sur Déconnecter »). Refus + repli impossible alors que
    `refreshTokenExpiresAt` est dans le futur → `TRADOVATE_REFRESH_DEFERRED` (503, connexion gardée
    `CONNECTED`, retentée à chaque passage) ; `NEEDS_RECONNECT` seulement une fois l'échéance
    passée (ou inconnue). Une vraie révocation est donc constatée au plus ~25 h après.
  - ⚠️ **Pause de 10 min après un refus passager** (`REFUSAL_COOLDOWN_S`, clé Redis
    `tradovate:refresh-refused:<id>`) : pendant la pause, `getAccessToken` lève `REFRESH_DEFERRED`
    et `refreshNow` rend `retry` **sans appeler Tradovate**. Sans elle, le WebSocket (backoff
    plafonné à 60 s) redemandait un refresh deux fois par minute pendant des heures (beta,
    2026-09-26). Levée par tout renouvellement réussi ; ne masque jamais un refresh_token échu.
  - ⚠️ **Deux comptes MTC sur le MÊME login Tradovate** (vu en beta avec les comptes de test) :
    la propagation se limite au même user MTC, donc leurs copies s'invalident mutuellement quand
    l'une renouvelle. Cas marginal chez de vrais users ; ne pas étendre la propagation entre users
    sans décision explicite (ce serait partager des tokens entre comptes MTC).
  - Un **401 sur une lecture de données** (token pourtant frais) ne condamne plus : `lastSyncError`
    + 503. Seul `getAccessToken` décide de `NEEDS_RECONNECT`, et `markNeedsReconnect(id, cause)`
    **journalise la cause** (warn « → À RECONNECTER (…) »).
  - ⚠️ **`HTTP 200` + `{"error":"invalid_token"}`** : le refus n'est pas un 401, et il est souvent
    **transitoire** (mesuré : refus d'un token jamais utilisé émis 1 h 50 plus tôt).
  - `TradovateTokenRefreshCron` (**toutes les heures** depuis le 2026-09-26, celles qui expirent
    sous 18 h) est le **seul** entretien d'un utilisateur dont l'app reste ouverte : le cron de fond
    le saute (`isLive`) et le WebSocket ne redemande un token qu'à sa réouverture. Il ne regarde
    jamais la présence. Il fait aussi la **seconde chance** : `NEEDS_RECONNECT` + refresh_token
    encore promis → `tryRevive` (refresh sous verrou de login ; accepté → `CONNECTED`).
  - **Portée LOGIN, pas connexion** (correctif du 2026-09-26). Tradovate fait tourner le
    refresh_token par **login** (`userId` Tradovate) ; un login porte souvent plusieurs comptes,
    donc plusieurs `BrokerConnection`, chacune avec SA copie des tokens. La première qui renouvelle
    invalide celle des autres — c'est ce qui tuait 2 des 5 connexions d'un ambassadeur.
    - `externalUserId` (colonne qui existait mais n'était **jamais écrite**) est posé au
      consentement, et **rattrapé** par la synchro via `rememberLogin` pour les connexions
      antérieures.
    - ⚠ **Le login, c'est `/user/list`, JAMAIS `account.userId`** (corrigé le 2026-09-27).
      `account.userId` est le **propriétaire du compte chez le broker** : sur un compte prop firm,
      c'est l'identifiant de la **firme**. Mesuré en prod : deux traders Apex sans aucun lien
      (`APEX_13679` et `APEX_428047`, e-mails différents) portaient tous deux `userId: 699523`, et
      `/user/item?id=699523` répondait **404** — ce n'est pas un trader. Tant qu'on écrivait cette
      valeur, **tous les traders Apex de la plateforme partageaient le verrou
      `tradovate:login:699523`** (goulot latent), et « sœur » voulait dire « compte chez la même
      firme ». `discoverLogin` lit donc `/user/list` (un seul élément, son `id`) ; échec ou réponse
      vide → login `null`, verrou par connexion, aucune propagation : dégradé, jamais bloquant.
    - **Un compte broker ne se relie qu'à UN seul compte MTC.** `dropAlreadyLinked` écarte, au
      consentement, tout compte déjà relié par un **autre utilisateur** MTC : il n'est ni choisi
      automatiquement ni offert à l'écran de sélection, et si c'était le seul, le retour est
      `reason=account_already_linked`. `selectAccount` refuse explicitement
      (`TRADOVATE_ACCOUNT_ALREADY_LINKED`) — l'utilisateur a désigné ce compte, il doit savoir
      pourquoi. Sans filtre de statut : une connexion « à reconnecter » garde son refresh_token et
      le cron peut la ressusciter, donc elle reste un voleur en sommeil. Contrepartie assumée : un
      compte abandonné par un autre utilisateur doit être délié chez lui, ce que dit le message.
      Le même utilisateur qui se reconnecte n'est jamais bloqué (`userId: { not: userId }`).
    - `selectAccount` **ne retouche pas** `externalUserId` : changer de compte ne change pas
      l'utilisateur authentifié, et y écrire `target.userId` réintroduirait l'identifiant de firme.
    - `rememberLogin` reçoit désormais **tous** les comptes du `/account/list` comme fratrie (ils
      appartiennent par construction à l'utilisateur de ce jeton), au lieu de les filtrer sur
      `account.userId`. La synchro n'appelle `/user/list` que si le login manque encore.
    - Verrou `tradovate:login:<externalUserId>` (TTL 30 s) autour du SEUL renouvellement — distinct
      du verrou de synchro `tradovate:sync:<id>` (TTL 120 s), pour que deux comptes d'un même login
      puissent continuer à se synchroniser en parallèle.
    - Verrou déjà pris → on attend puis on relit : la sœur a propagé, son access token est en base.
      Si elle n'a rien donné, on tente quand même (jamais bloqué par un verrou).
    - Après un renouvellement réussi, `propagateToSiblings` écrit les nouveaux tokens sur toutes les
      connexions du même login **et les repasse `CONNECTED`** : une sœur condamnée par une rotation
      concurrente l'avait été à tort, le login vient de répondre.
    - Sans `externalUserId`, aucune propagation : on ne devine pas les liens de parenté.
  - Détail cluster : en prod l'API tourne en **3 workers** (`WEB_CONCURRENCY`, défaut), seul le worker 0 porte
    `IS_CRON_WORKER=true` (`main.ts`, `cluster.fork`). `docker exec printenv IS_CRON_WORKER`
    répond « absent » — il lit l'env du conteneur, pas celui du worker. Vérifier via
    `/proc/<pid>/environ` avant de conclure qu'aucun cron ne tourne.
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
  → `TRADOVATE_UNAVAILABLE`.
- **Compte absent de `account/list` ≠ déconnexion** (bug prod du 2026-09-26 : un compte prop firm
  de Val a disparu de son login pendant la maintenance du week-end, le token marchait toujours,
  l'app lui disait « reconnecte-toi »). `handleMissingAccount` :
  - présent sur l'**autre hôte** → `externalEnv` corrigé, la synchro continue ;
  - absent depuis moins de `ACCOUNT_GONE_GRACE_MS` (2 h sans synchro réussie) →
    `TRADOVATE_ACCOUNT_TEMPORARILY_MISSING` (503), rien de détaché ;
  - absent durablement → connexion **détachée** (`externalAccountId/Env/Name = null`, reste
    `CONNECTED`), `availableAccounts` relu sur les 2 hôtes, `TRADOVATE_ACCOUNT_NOT_FOUND` (« choisis
    le compte à synchroniser »). Le front affiche le sélecteur : `needsAccountSelection` vaut
    désormais `!externalAccountId && available.length >= 1` (même avec un seul compte restant :
    on ne verse jamais les trades d'un autre compte broker sans le demander). `selectAccount`
    efface `lastSyncError`.
- P&L = **brut** `(vente − achat) × qty × valuePerPoint`, frais dans `commission` (comme le CSV).
  `tradedAt` tronqué à la seconde (granularité de l'export).
- **Rapprochement CSV ↔ API** : l'export Performance est en heure LOCALE sans fuseau, parsée
  dans le fuseau du serveur (`TZ=Europe/Paris` en beta). L'empreinte exacte ne coïncide donc
  pas ; `isCrossSourceDuplicate` reconnaît le même trade décalé d'un nombre entier de
  demi-heures (≤ 14 h), mêmes prix, même P&L. Appliqué par `importTrades` dans les DEUX sens :
  CSV importé avant la synchro, ou après (avant le 14/09/2026, seul le premier sens était
  couvert : un CSV importé après la synchro recréait les trades en double si le Tradovate de
  l'utilisateur n'affichait pas l'heure du serveur).
- ✅ **Profondeur d'historique : résolue** par la Reporting API, bornée par la date de création du
  compte (cf. plus haut). Mesuré le 2026-09-26 : la sonde remonte jusqu'à 24 mois et ne renvoie
  rien avant le premier trade réel — la profondeur servie est donc tout ce que le compte contient.
  Reste non testé : un compte de plus de 3 mois d'ancienneté de données, et l'archivage à 10 jours
  d'un compte inactif (documenté, jamais vérifié) après quoi l'historique devient illisible.
- ⚠ **Profondeur d'historique non garantie (Trade API)** : l'API REST pourrait ne renvoyer que les
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
- Branchement (tous nécessaires) :
  - `tsconfig.base.json` : **seul** `paths` `@mtc/shared`, hérité par l'API, l'app, l'admin et
    `tsx` (seed). C'est aussi ce que Nx lit pour le graphe : sans lui, `nx affected` ne voyait
    pas que les apps dépendent de la lib. Ne jamais redéclarer `paths` dans un tsconfig d'app
    (il remplacerait celui de la base) ;
  - `tsconfig.app.json` de l'API : la lib dans `include` (projet `composite`) + `rootDir: ../..` ;
  - `webpack.config.js` : alias posé dans le hook `NodeModulesExternalsPlugin` (le plugin paths de
    Nx ne lit pas nos `paths`) ET `@mtc/*` exclu des externals — sinon `require('@mtc/shared')`
    au démarrage, introuvable dans node_modules ;
  - `vitest.config.mts` et `vitest.integration.config.mts` : `resolve.alias` (vitest ignore `paths`).
- Tests de la lib : dans `libs/shared/src/*.spec.ts`, lancés par `pnpm nx test shared`
  (plus dans l'API). Typecheck : `pnpm nx typecheck shared`.
- Frontières (`eslint.config.mjs`, `@nx/enforce-module-boundaries`) : tags `type:*` / `scope:*`
  sur chaque projet ; `libs/shared` (`scope:shared`) n'importe que lui-même, une app n'importe
  jamais une autre app, le front n'importe jamais l'API. Un import interdit casse le lint.
- Créer une nouvelle lib : `pnpm nx g @nx/js:lib libs/<nom> --bundler=none`, lui donner ses tags,
  puis déclarer son alias dans `tsconfig.base.json` (et dans les alias vitest / webpack si une
  app de test ou l'API l'importe).
- Ré-exporter une valeur de la lib : `export { X } from '@mtc/shared'` — jamais un import suivi de
  `export { X }`, effacé par la transpilation fichier par fichier (webpack : « export not found »).
- Pas de `tsconfig.json` dans `libs/shared` (volontaire) : le plugin TS de Nx y ajouterait des
  cibles et `nx sync` (lancé dans le Dockerfile) ajouterait aux apps des références vers une lib
  non composite, ce qui casse le build. Le typecheck de la lib lit `tsconfig.check.json`.
- Types d'API front/back (27 noms en double) : PAS encore partagés — les dates y sont `Date` côté
  API et `string` côté front (JSON) ; à traiter avec un type de transport dédié.

## Import CSV : parseurs purs (étape 4 de l'audit, 2026-09-13)

- `trades/csv-parsers.ts` : détection du broker, normalisation au CSV pivot (Tradovate, Binance
  futures/spot, Bybit, IBKR, MEXC, MT4/MT5), séparateur européen, `splitCsvLine`,
  `mapNormalizedCsvToDto`, `detectSession`, et les types `BrokerType` / `ImportDto`. Fonctions
  PURES : aucun service injecté, testables directement (`csv-import.service.spec.ts` les importe).
- `CsvImportService` garde l'orchestration : plan / accès IA, formats inconnus, fusion des
  frais Tradovate, persistance.
- **Nouveau broker : passer par le REGISTRE, pas par du code** (2026-09-28). Écrire un
  `parseXxx` reste possible mais n'est plus la voie normale : un admin colle un échantillon
  dans `/brokers` (admin), le modèle déduit la fiche, l'admin la corrige et l'enregistre, et
  le broker est reconnu **pour tous les plans** sans build ni déploiement. Les 7 parseurs en
  dur restent en place pour les brokers historiques.

## Registre des brokers (2026-09-28)

Ordre de résolution d'un import, à ne pas réarranger :

1. `detectBroker` reconnaît l'en-tête → parseur en dur, local, gratuit.
2. **Registre** (`BrokerMappingService.findByHeader`) → fiche en base, local, gratuit, **tous
   les plans**. Placé AVANT le verrou Premium : c'est toute la raison d'être du registre.
3. Le fichier ressemble-t-il à un export de trades ? Sinon message neutre, sans upsell.
4. Chemin IA (`PremiumGuard` + `AI_ENABLED`) : d'abord un **mapping** (un appel, ~0,003 $,
   coût indépendant de la taille), et seulement s'il échoue le repli ligne par ligne
   (`AI_BATCH` = 120, ~1,43 $ pour 2000 lignes).

Fichiers : `trades/csv-mapping.ts` (types, validation de forme, application, contrôle du P&L,
`headerSignature`), `trades/broker-mapping.service.ts` (lecture/écriture des fiches),
`admin/admin-broker-mappings.controller.ts` (`analyse` payant, `preview` gratuit, `POST`).

**Le sens (long/short) ne se prend jamais sur parole.** Mesuré le 2026-09-28 sur 5 formats :
les modèles identifient les colonnes de façon fiable (30/30 critères) mais se trompent de sens
2 fois sur 5, et une inversion transforme tous les longs en shorts sans qu'aucune erreur ne
remonte. Le sens est donc tranché par le **signe du P&L** (`applyMappingWithPnlCheck`) :
un long gagne quand la sortie dépasse l'entrée. Si le mapping contredit les chiffres, il est
inversé ; si le contrôle est impossible (pas de prix d'entrée, type Binance Futures) ou sous
80 %, on **renonce** et on retombe sur le parcours « broker inconnu ». Un import cher vaut
mieux qu'un import faux.

Ce contrôle est rejoué **à chaque import**, pas seulement à la validation : la fiche a été
validée sur 20 lignes d'un utilisateur, elle s'applique au fichier entier d'un autre.

Deux limites connues, documentées dans `csv-mapping.ts` : en mode horodatages, permuter les
colonnes de temps inverse le sens ET l'entrée/sortie, donc le P&L ne tranche pas ; un trade
dont les frais dépassent le gain brut a un signe « faux » sans rien de cassé, d'où un seuil en
part de lignes et non la perfection.

## Robustesse de l'API (audit du 27/09/2026)

- **Erreurs** : `HttpExceptionFilter` est global (`@Catch()`), toute erreur sort au format
  `{ statusCode, code?, message, timestamp, path }`. Prisma non rattrapé : P2002 → 409
  `CONFLICT`, P2025 → 404 `NOT_FOUND` ; le reste → 500 `INTERNAL` sans détail (pile dans les
  logs + Sentry). `path` et les logs n'incluent jamais la query string.
- **Sentry** : `src/instrument.ts`, premier import de `main.ts`, actif seulement si `SENTRY_DSN`.
  Les 5xx sont remontées par le filtre global ; ne pas ajouter de `captureException` ailleurs.
- **IA** : modèles dans `AI_MODELS` (`modules/infra/ai-pricing.const.ts`), jamais en dur ; un
  test vérifie que chaque modèle a son tarif. Délai par appel = `max(60 s, 30 ms × max_tokens)`,
  une seule relance, chaque échec tracé (sans le contenu envoyé).
- **Santé** : `GET /api/health` = liveness (process vivant, healthcheck Docker) ;
  `GET /api/health/ready` = readiness (ping Postgres + Redis, 503 en nommant le composant).
- **Environnement** : `src/config/env.ts` est la liste de référence (required / production /
  optional + format). Nouvelle variable → l'y ajouter ET dans `apps/api-mytradingcoach/.env.example`.
- **Redis** : `RedisService` se connecte à l'init (`onModuleInit`) ; sans ça, la 1re commande de
  chaque worker échouait (`lazyConnect` + `enableOfflineQueue: false`).

## Contrat front ↔ API (`libs/shared/src/contracts`, audit du 27/09/2026)

- **Source unique des formes JSON échangées** : enums (copie des enums Prisma), trades, sessions,
  débrief, calendrier éco, fiche utilisateur admin, stats VPS. Import : `from '@mtc/shared'`.
- Les dates y sont des `string` ISO (ce que le front reçoit). Côté API, les DTO de requête
  `implements` le contrat (`CreateTradeDto implements CreateTradeRequest`) : un champ ajouté d'un
  seul côté casse la compilation.
- Enums : `EmotionState.FOCUSED` (valeur) / `EmotionState` (type). Le test API
  `common/contracts-sync.spec.ts` compare chaque enum à Prisma : après une migration qui touche un
  enum, mettre à jour `contracts/enums.ts`.
- Jamais de nouvelle interface d'échange recopiée dans `core/api/*.api.ts` : l'ajouter au contrat,
  puis la ré-exporter (`export type { X }`) si des importeurs existants passent par l'API front.
- Aussi partagés : `todayParis` / `parisDayRange` (dates Paris), `normalizeEventKey` / `eventKey`,
  `renderEmailMarkdown` (rendu des campagnes, envoi + aperçu admin).

## PDF du débrief — Chromium réutilisé (SCA-B0-06, 2026-09-30)

`PdfService` garde **un seul** Chromium par process (lancé à la demande, fermé après 5 min sans
PDF ou 200 rendus, recyclé après une erreur), rend **un PDF à la fois** (file interne) avec un
timeout de 20 s, et referme toujours la page. Ne jamais revenir à `puppeteer.launch` par requête :
150 à 300 Mo par instance, 3 ou 4 téléchargements simultanés suffisaient à l'OOM.
Tout texte IA ou utilisateur injecté dans le HTML passe par `escapeHtml()`.
Pas de cache Redis des PDF : Redis prod (256 Mo, `noeviction`) porte les files BullMQ.

## E-mails Resend : débit, quotas, volume (2026-10-01)

- **Tout envoi passe par `ResendService.send()`** (ou une méthode `send*` qui l'appelle) :
  - `rate_limit_exceeded` (Resend : **10 requêtes/s par équipe**) → 3 nouveaux essais (1 s, 2 s, 4 s) ;
  - tout autre échec → `logger.error` **et Sentry** (`fingerprint ['resend-send-failed', <erreur>]` :
    un quota dépassé = une seule issue ; `daily_quota_exceeded` / `monthly_quota_exceeded` en `fatal`) ;
  - jamais de throw (un e-mail raté ne fait pas échouer un job) ;
  - compteur du jour `resend:sent:<AAAA-MM-JJ UTC>` dans Redis ; au **80e** envoi
    (`RESEND_DAILY_WARN`), alerte Sentry de niveau **`error`** (la règle d'alerte n'envoie d'e-mail que pour la priorité haute ; `warning` = priorité moyenne = aucune notification) : seuil décidé pour passer du plan gratuit
    (100/jour) au plan Pro. Redis en panne → l'envoi part quand même.
- **Pas de `Promise.all` sur une liste d'utilisateurs qui envoie des e-mails** :
  `mapWithConcurrency(items, 4, fn)` (`common/utils/concurrency.util.ts`). Récap quotidien et
  rappels de renouvellement corrigés (ils tiraient tous les envois en même temps → 429 perdus).
- **Pas d'adresse e-mail complète dans les logs** : `maskEmail()` (`j***@gmail.com`) ; un cron
  logue un **nombre**, pas la liste des destinataires.

## Contexte marché poussé (SCA-B4-03, 2026-10-01)

`eco-calendar/market-context.cron.ts` : toutes les 15 s, **sur le worker cron**, diffuse
`market:context` à tous les clients du namespace `/eco` (adaptateur Redis → tous les workers). Rien
si aucun client connecté (`gateway.connectedCount()`), donc pas d'appel Yahoo la nuit. La donnée
vient de `MarketDataService.getMarketContext()` (cache Redis 15 s). La route HTTP
`GET /market/context` reste pour le secours du front (5 min) et le premier affichage.

## Acquisition UTM (oct. 2026)

- `POST /auth/register` accepte `acquisitionSource` / `acquisitionMedium` / `acquisitionCampaign`
  (optionnels, ≤ 100 car., trim + minuscules dans `RegisterDto`, vide → absent). **Déployer l'API
  avant l'app** : `forbidNonWhitelisted` rejette en 400 tout champ inconnu.
- `GET /admin/acquisition` (`AdminService.getAcquisition`, contrat `AdminAcquisitionData` de
  `@mtc/shared`) : une requête SQL groupée par source, hors `isDemo` et hors ADMIN. Premium =
  `stripeSubscriptionStatus IN ('active','trialing','past_due')`, `trialing` renvoyé à part.
  `source: null` = direct / non renseigné. Page admin : `/acquisition` (nav Business).
- La réponse inclut aussi les **visites landing** (`visits7d/30d` par source, `daily` sur 30 j,
  `topPages`) lues dans `LandingVisitDaily`. Le taux global visite → inscription ne compte que les
  sources ayant des visites (sinon les inscrits arrivés direct sur l'app le font dépasser 100 %).
- `POST /public/visit` (public, 60/min/IP, toujours 204) : `{ path, source?, entry }`. Robots
  filtrés par User-Agent (`BOT_UA` dans `PublicService`), erreur base avalée et loggée.
  **Pas de cookie, pas d'IP stockée** (exemption CNIL) : ne pas y ajouter de donnée personnelle.

## Statistiques calculées en SQL (SCA-B2-01, 2026-10-02)

`analytics/analytics.sql.ts` : `groupTrades` (agrégats par setup / émotion / actif / session /
heure / jour-heure / date de Paris), `summaryTotals` (sommes, drawdown max, série en cours en
fenêtres SQL), `cumulativeByTrade`. **Plus aucun calcul ne charge tous les trades en mémoire.**
- Règles reproduites à l'identique : net = `round(pnl − |commission|, 2)` (comme `netPnl`),
  gagnant si net > 0 ; R:R compté s'il est renseigné et non nul ; heure / jour dans le **fuseau du
  processus** (`processTimeZone()`, comme les anciens `getHours()` ; TZ=Europe/Paris en prod) ;
  dates d'activité à Paris. Les sélections (meilleure session : strictement supérieur, égalités
  au premier apparu → `bestByWinRate`) restent en JS.
- Valeurs en **paramètres liés** (`Prisma.sql`) ; les seules expressions brutes viennent de la
  liste blanche `GroupKey`. Jamais de `Prisma.raw` sur une entrée.
- Gain mesuré (compte 50 000 trades) : CPU Node par appel divisé par 100 à 1 500 (courbe
  journalière 12,6 s → 0,42 s).
- **Toute modification d'un calcul** : `analytics-sql-equivalence.int-spec.ts` (5 000 trades
  piégeux, étalon figé `src/test/analytics-legacy.service.ts`, écart ≤ 0,01) et
  `analytics.service.scenarios.int-spec.ts` (scénarios métier sur vrai Postgres) doivent passer.
  Un changement VOLONTAIRE de règle → modifier aussi l'étalon, et le dire dans la PR.

### Stats du journal en SQL (SCA-B2-02, 2026-10-02)

`GET /trades/stats` → `journalStatsSql` (journal-stats.util.ts), plus de chargement des trades.
**Le filtre existe en deux versions côte à côte** dans `trade-filters.util.ts` :
`buildTradeWhere` (Prisma, liste paginée) et `buildTradeFilterSql` (SQL, stats). **Tout nouveau
filtre ou changement de filtre se fait dans les deux** ; `journal-stats-sql.int-spec.ts` vérifie
pour chaque filtre et 80 combinaisons que les deux sélectionnent les mêmes trades, et que les
stats égalent l'étalon `summarizeJournal`.
