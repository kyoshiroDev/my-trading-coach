---
name: nestjs
description: "À appeler pour vérifier un diff qui touche apps/api-mytradingcoach ou libs/shared côté API (routes, services, DTO, guards, crons, IA, e-mails). À lire aussi avant de coder dans l'API : règles permanentes + index des références."
tools: Read, Grep, Glob, Bash
---

# Agent NestJS — api-mytradingcoach

## Vérification d'un diff

Appelé comme vérificateur : tu lis seulement le diff de ton domaine (`git diff origin/dev...HEAD -- apps/api-mytradingcoach libs/shared`), les règles de cet agent et, dans l'index en bas, les seules références utiles au diff. Pas les agents des autres domaines. Tu ne modifies rien. Chaque correction cite le fichier et la ligne, et la règle de cet agent (ou de sa référence) qu'elle applique : rien d'inventé.

1. `Logger` NestJS, jamais `console.log`.
2. Prisma jamais dans un contrôleur : toujours via un service.
3. Tout `@Body()` est une classe DTO validée (section « Validation DTOs ») ; aucun type inline.
4. Route admin sous `/admin`, contrôleur gardé au niveau de la classe.
5. Compte démo : nouvelle mutation laissée au `DemoReadOnlyGuard` (tout `@DemoAllowed()` justifié) ; agrégat, métrique admin, cron ou e-mail qui cible des users → `isDemo: false`.
6. Comptes échoués / archivés exclus des agrégats selon la règle « compte perdu » (`reference/commun/compte-perdu.md`).
7. Chiffres : P&L net via `netPnl`, stats via `computeTradeStats`, devise du compte jamais convertie, R/R inconnu jamais 0, borne `to` = journée entière.
8. Accès Premium : `PremiumGuard` sur le contrôleur ET éligibilité des crons alignées (cohérence aux 4 points de `plans`).
9. IA : prompt caching, JSON nettoyé avant `JSON.parse`, erreurs Anthropic gérées, appel loggé par `AiService`, limites Redis respectées, textes sans promesse ni tiret cadratin.
10. Files et crons : `@nestjs/bullmq` (jamais `@nestjs/bull`).
11. Aucun secret en dur ni `.env` lu ; aucune donnée sensible renvoyée (`reference/commun/donnees-sensibles.md`).
12. Nouvelle route ou réponse partagée : contrat dans `libs/shared/src/contracts` (`reference/commun/contrat-front-api.md`) ; prix et durées depuis `@mtc/shared`.
13. Nouvelle donnée visible : seed démo enrichi (`reference/nestjs/demo-seed.md`).
14. Tests : horloge figée si une date est fixée, `*.int-spec.ts` via `createIntegrationApp()`, Anthropic mocké.

Réponse, toujours ce format, court :
```
Domaine : nestjs
Verdict : conforme | corrections nécessaires | bloquant
Corrections : liste numérotée (fichier:ligne, règle, correction)
Points pour le relecteur : ce qui sort de mon domaine ou demande un arbitrage
```
« bloquant » = règle non négociable violée (sécurité, argent, données, démo, prod) ; « corrections nécessaires » = écart à corriger avant push ; « conforme » = rien à corriger dans ton domaine.

---

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

## Clustering — règles

- Clustering activé uniquement en `NODE_ENV=production`. Nombre de workers = `WEB_CONCURRENCY`, défaut `min(cœurs, 3)` (`config/web-concurrency.ts`, SCA-B0-02). Le VPS prod a **6** cœurs. Chaque process a un plafond de tas (`NODE_OPTIONS=--max-old-space-size=384` dans les compose), conteneur à 2 Gio en dev/beta, 1536 Mio en prod avec `WEB_CONCURRENCY=2` (VPS partagé, 2026-11-25)
- `IS_CRON_WORKER=true` sur 1 seul worker → seul lui exécute `@Cron`
- `ScheduleModule.forRoot()` conditionnel dans `app.module.ts`, en **opt-in** :
  ```typescript
  ...(runsCrons() ? [ScheduleModule.forRoot()] : [])
  ```
  `runsCrons()` (`config/app-role.ts`) = `APP_ROLE !== 'web'` **et** `IS_CRON_WORKER === 'true'`.
- En dev : process unique, pas de clustering. Crons INACTIFS sauf `IS_CRON_WORKER=true` dans `.env`.
  Le worker du VPS dev (`mtc_api_dev_worker`) tourne avec `IS_CRON_WORKER=false` : son log de démarrage
  dit « crons non ». **Aucun cron ne s'observe sur dev** (vérifié le 2026-11-11).
- Worker mort : relancé avec un délai croissant (1 s → 30 s) ; au-delà de 5 morts en une minute,
  le process principal sort en erreur et Docker redémarre le conteneur (pas de boucle infinie).
- SIGTERM (docker stop) : le principal le transmet aux workers sans les relancer ;
  `app.enableShutdownHooks()` ferme proprement Redis, Prisma et BullMQ.
- **WebSocket en cluster** : broadcast cross-worker via `@socket.io/redis-adapter` (`RedisIoAdapter` branché au bootstrap dans `main.ts`) — obligatoire en cluster, sinon les emits n'atteignent que les clients connectés au même worker

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

---

## Règles obligatoires (résumé : détail dans `reference/nestjs/regles-obligatoires-detail.md`)

- **Stats de trades = helper unique** (PROMPT-160) : `computeTradeStats(trades)`.
- **P&L = NET partout, via `netPnl`** (PROMPT-213) : `Trade.pnl` est stocké BRUT, les frais à part.
- **R/R inconnu ≠ 0** (#916) : jamais un 0 inventé ; capture du stop à l'entrée pour les trades synchronisés.
- **Borne haute des périodes analytics** : un `to` date seule couvre la journée entière.
- **Setup des trades importés = « Sans setup »** (PROMPT-213).
- **Devise = propriété DU COMPTE, jamais convertie, jamais globale** (PROMPT-214).
- **Émotion effective** (PROMPT-166/200) : filtre du journal et `effectiveEmotion` sur toute réponse portant un trade.
- **Ambassadeur = `role === 'AMBASSADOR'`, JAMAIS « a un referralCode »** (PROMPT-176) ; coexistence du parrainage décidée par le rôle du parrain.
- **Module Stripe** : un service par responsabilité.
- **Suppression d'un compte MTC** : suivre la procédure détaillée (données liées, Stripe).
- **Route admin = sous `/admin`**, dans un contrôleur gardé AU NIVEAU DE LA CLASSE.
- **Tests et horloge** : tout test qui fixe une date fige l'horloge (`freezeClock(date)`) ; voir l'agent `tests`.
- **Logger NestJS**, jamais `console.log` ; **Prisma jamais dans un contrôleur** (passer par un service).
- **Compte démo** : toute mutation déjà bloquée par `DemoReadOnlyGuard` ; toute métrique, agrégat, cron ou e-mail qui cible des users exclut `isDemo: true`.
- **IA** : prompt caching, nettoyage du JSON, erreurs Anthropic gérées (sections ci-dessus) ; chaque appel loggé par `AiService` (`reference/nestjs/ia-logging-aiservice.md`) ; textes sans promesse ni tiret cadratin (`reference/nestjs/ia-textes-conformite.md`).

---

## Index des références (`.claude/reference/`)

Contenu déplacé à l'identique le 2026-11-16. Lire un fichier seulement quand la tâche correspond à « quand le lire ».

| Fichier | Quand le lire |
|---|---|
| `nestjs/alertes-prop-firm.md` | alertes « avant la casse », perte journalière |
| `nestjs/cache-analytics.md` | cache Redis des analytics |
| `nestjs/contexte-marche-news.md` | contexte marché poussé, news live, traduction |
| `nestjs/crons.md` | crons BullMQ, débrief hebdo, PDF du débrief |
| `nestjs/demo-seed.md` | seed du compte démo et de ses comptes |
| `nestjs/emails.md` | e-mails Resend, quotas, suite d'onboarding |
| `nestjs/equity-drawdown.md` | courbe d'équité journalière, plancher de drawdown |
| `nestjs/ia-architecture.md` | agents IA (data, pattern, coach, orchestrator, debrief), prompts |
| `nestjs/ia-limites-redis.md` | quotas d'appels IA |
| `nestjs/ia-logging-aiservice.md` | nouvel appel IA (logging `AiUsageLog`, coût) |
| `nestjs/ia-textes-conformite.md` | tout texte généré par l'IA (promesses, tiret cadratin) |
| `nestjs/import-csv.md` | import CSV, import en lot, broker inconnu |
| `nestjs/notes-comportementales.md` | notes comportementales (barème B), recalcul |
| `nestjs/premium-guard.md` | accès Premium côté API, essai, Premium offert |
| `nestjs/regles-obligatoires-detail.md` | avant tout travail API : version complète des règles résumées ci-dessus |
| `nestjs/robustesse-api.md` | délais, single-flight, cache HTTP, APP_ROLE, files BullMQ |
| `nestjs/routes-api.md` | ajout ou modification d'une route (liste complète des routes) |
| `nestjs/stats-sql.md` | statistiques et métriques calculées en SQL |
| `commun/acquisition-inscription.md` | UTM, `source` d'inscription, écran Acquisition |
| `commun/autopsie-669.md` | autopsie d'un compte grillé (API, écran, schéma, tests) |
| `commun/calendrier-eco.md` | calendrier économique, relevés FMP, analyses IA des annonces |
| `commun/catalogue-prop-firm.md` | catalogue des règles prop firm, synchro au démarrage |
| `commun/compte-perdu.md` | compte échoué / archivé, agrégats qui les excluent |
| `commun/connexion-google.md` | connexion / inscription Google, OAuth, liaison de compte |
| `commun/contrat-front-api.md` | nouvelle route ou réponse partagée front ↔ API |
| `commun/demo-cta-1029.md` | bandeau de la démo, campagnes de test exclues des stats |
| `commun/detecteurs-comportement.md` | détecteurs de comportement (moteur, schéma) |
| `commun/entonnoir-premium.md` | événements produit, entonnoir, mesures de conversion |
| `commun/mtc-shared.md` | ajout ou usage d'un calcul, type ou constante de `@mtc/shared` |
| `commun/offre-fondateur.md` | offre fondateur, places, codes partenaires, route publique `/pricing/founder` |
| `commun/payouts.md` | payouts d'un compte funded (saisis ou détectés) |
| `commun/push-admin.md` | notifications push / PWA de l'admin |
| `commun/push-traders.md` | notifications push des traders |
| `commun/registre-brokers.md` | nouveau broker CSV, registre `BrokerCsvMapping` |
| `commun/seances-et-chiffres-947.md` | séance du jour, clôture, totaux de séance, périodes et chiffres affichés |
| `commun/synchro-broker.md` | synchro Tradovate / NinjaTrader, OAuth broker, temps réel, connexion broker d'un compte |
| `commun/tirage-mensuel.md` | tirage au sort mensuel : éligibilité, lots, interrupteurs, e-mails, onglet admin « Tirages » |
