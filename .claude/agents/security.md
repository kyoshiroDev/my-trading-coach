# Agent Security — Auth, Guards, JWT, Variables d'env

## Stack sécurité
Argon2 · JWT (Passport) · Helmet · CORS · HTTPS only · Variables d'env Bitwarden

---

## Authentication JWT

```typescript
// Access token : 15 minutes
// Refresh token : 7 jours, httpOnly cookie

// Payload JWT
interface JwtPayload {
  sub: string;      // userId
  email: string;
  plan: Plan;
  trialEndsAt?: string;
}
```

---

## Argon2 — Mots de passe

```typescript
// Hash
const hash = await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
});

// Vérification
const valid = await argon2.verify(user.password, password);
if (!valid) throw new UnauthorizedException('Email ou mot de passe incorrect');
```

**Jamais Bcrypt** — Argon2id est le standard actuel.

---

## Guards

### JwtAuthGuard — sur toutes les routes protégées

```typescript
@UseGuards(JwtAuthGuard)
@Get('profile')
getProfile(@CurrentUser() user: User) { ... }
```

### PremiumGuard — routes IA et analytics avancés

```typescript
// Autorisé si :
// - user.plan === 'PREMIUM'
// - OU user.trialEndsAt && new Date() < new Date(user.trialEndsAt)

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

### Routes avec guards

```typescript
// PAS de PremiumGuard (FREE y accède)
GET /api/analytics/summary

// PremiumGuard OBLIGATOIRE
POST /api/ai/insights
POST /api/ai/chat
GET  /api/analytics/by-setup
GET  /api/analytics/by-emotion
GET  /api/analytics/by-hour
GET  /api/analytics/equity-curve
GET  /api/analytics/top-assets
GET  /api/debrief/*
POST /api/debrief/generate
```

---

## Helmet + CORS dans main.ts

```typescript
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());

  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:4200'],
    credentials: true,
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // Filtre et intercepteur réels : enregistrés en APP_FILTER / APP_INTERCEPTOR (app.module.ts).
  // `app.set('trust proxy', 1)` : l'API est derrière Traefik (voir Rate Limiting).

  await app.listen(process.env.PORT ?? 3000);
}
```

---

## Variables d'environnement

### Jamais hardcoder — jamais commiter `.env.production`

```bash
# Requises en production
NODE_ENV=production
# DATABASE_URL → PgBouncer (app), DATABASE_DIRECT_URL → Postgres direct (migrations)
DATABASE_URL=postgresql://mtc_user:PASSWORD@mtc_pgbouncer:6432/mytradingcoach_prod?pgbouncer=true&connection_limit=1
DATABASE_DIRECT_URL=postgresql://mtc_user:PASSWORD@mtc_postgres:5432/mytradingcoach_prod
REDIS_HOST=mtc_redis
REDIS_PORT=6379
REDIS_PASSWORD=...
JWT_SECRET=...                  # minimum 64 caractères aléatoires
JWT_REFRESH_SECRET=...          # minimum 64 caractères aléatoires
ANTHROPIC_API_KEY=sk-ant-...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
RESEND_API_KEY=re_...
FRONTEND_URL=https://app.mytradingcoach.app
CORS_ORIGINS=https://app.mytradingcoach.app,https://mytradingcoach.app
```

### Stockage sécurisé
- **Bitwarden** : notes sécurisées "MTC — Production" et "MTC — Dev"
- **GitHub Secrets** : environnements `production` et `development`
- `apps/api-mytradingcoach/.env.example` versionné avec des valeurs vides — jamais les vraies valeurs

---

## Stripe Webhooks

```typescript
@Post('webhook')
@HttpCode(200)
async handleWebhook(
  @Headers('stripe-signature') sig: string,
  @Req() req: RawBodyRequest<Request>
) {
  const event = this.stripe.webhooks.constructEvent(
    req.rawBody,
    sig,
    process.env.STRIPE_WEBHOOK_SECRET
  );

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await this.handleSubscriptionUpdate(event.data.object);
      break;
    case 'customer.subscription.deleted':
      await this.handleSubscriptionCanceled(event.data.object);
      break;
    case 'invoice.payment_failed':
      await this.handlePaymentFailed(event.data.object);
      break;
  }
}
```

---

## Ne jamais exposer

```typescript
// Exclure systématiquement dans les réponses
const { password, stripeCustomerId, ...safeUser } = user;
return safeUser;

// Ou avec Prisma select
const user = await prisma.user.findUnique({
  where: { id },
  select: {
    id: true, email: true, name: true,
    plan: true, trialEndsAt: true, trialUsed: true,
    createdAt: true
    // password: false — jamais
    // stripeCustomerId: false — jamais
  }
});
```

---

## Rate Limiting

- **Défaut** : 60 requêtes / minute / IP (`ThrottlerModule.forRootAsync` dans `app.module.ts`,
  `ThrottlerGuard` en APP_GUARD). Surcharge par route : `@Throttle({ default: { ttl, limit } })`.
- **IP réelle** : `app.set('trust proxy', 1)` dans `main.ts` (un seul saut : Traefik). Sans lui,
  `req.ip` = IP du proxy → tous les users dans le même compteur. Ne jamais monter à `true`
  (le client pourrait forger `X-Forwarded-For`).
- **Compteurs dans Redis** (`common/throttler/redis-throttler.storage.ts`, script Lua atomique) :
  communs aux workers du cluster. Repli automatique en mémoire si Redis tombe (jamais bloquant).
- **Limites dédiées** : auth (login 10, register 5, forgot-password 3, reset-password 5,
  demo-login 20 / min), IA (insights, chat : 20 / min), Tradovate et routes publiques.
  Toute nouvelle route qui envoie un email ou coûte un appel IA reçoit son `@Throttle`.

## Validation des entrées

- **Tout `@Body()` est une classe DTO** (class-validator). Un type inline
  (`@Body() body: { … }`) n'est PAS validé par le ValidationPipe : `whitelist` et
  `forbidNonWhitelisted` ne s'appliquent pas, et le corps arrive tel quel. C'est ce qui
  permettait d'écrire n'importe quelle colonne via `PATCH /session/:id` (corrigé).
- Ne jamais passer un DTO entier à `prisma.*.update({ data })` : recopier les champs autorisés.

---

## Secrets broker & OAuth (PROMPT-207)

- **Tokens broker chiffrés en base** (AES-256-GCM, `common/utils/token-cipher.util.ts`, format
  `v1:iv:tag:ct`), clé dédiée `BROKER_TOKEN_ENCRYPTION_KEY` (32 octets base64), distincte de
  `JWT_SECRET`. Aucune route ne renvoie les colonnes `*Enc` ; les logs n'impriment jamais un
  corps de réponse d'auth du broker.
- **MTC ne voit jamais le mot de passe Tradovate** : OAuth, échange du code côté serveur
  uniquement (le `client_secret` ne transite jamais par le navigateur).
- **`state` OAuth** : HMAC-SHA256 avec une clé DÉRIVÉE de `JWT_SECRET` (pas un JWT : il passe
  dans une URL tierce, il ne doit pas pouvoir servir de Bearer). TTL 10 min. Doublé d'un
  **cookie httpOnly obligatoire** au callback (anti « connexion forcée » : sans lui, un tiers
  ferait consentir une victime avec son lien et recevrait ses trades).
- Déconnexion = suppression des tokens en base (la Trade API n'expose pas de révocation
  documentée). Suppression d'un compte ou d'un user → cascade.
- Client broker **lecture seule** : aucune méthode d'écriture (ordres) n'existe côté API MTC.
- **Canal temps réel `/tradovate-live` authentifié** (PROMPT-210 live) : contrairement à `/eco`
  (données publiques), il porte des trades. JWT vérifié au handshake (`JwtService`), comptes
  démo refusés, émissions uniquement vers la room `user:<id>` — jamais de `server.emit` global.
  Le JWT n'est contrôlé qu'à la connexion : le client en renvoie un frais à chaque reconnexion.
  Le WebSocket Tradovate côté serveur n'envoie que `authorize`, `user/syncrequest` et `[]`.

## Dépendances vulnérables (audit du 2026-09-13)

- Contrôle : `pnpm audit --prod`. Ordre de traitement : correctifs **dans la majeure installée**
  d'abord (`pnpm update` dans les plages, ou version exacte pour NestJS), montées majeures ensuite,
  sur une branche dédiée.
- Les failles **transitives** qu'aucune version à jour ne corrige se ferment par des
  `overrides` dans `pnpm-workspace.yaml` (pnpm ≥ 11 ne lit plus le champ `pnpm` de
  `package.json`) — toujours sous la forme d'un **plancher borné à la même majeure**
  (`'ws@>=8.0.0 <8.21.0': '^8.21.0'`), jamais un saut de majeure implicite. Chaque plancher est
  commenté (pourquoi, depuis quand).
- NestJS : `core` + `common` + `platform-express` épinglés ensemble à la même version exacte
  (overrides + `package.json` racine + API). Une double instance fait crash-loop l'API au boot.
- Résultat de l'étape 1 : 108 → 19 alertes. Restent, volontairement : Astro (critique, corrigée
  seulement en 7.2.8 → montée majeure), `sharp` 0.35 (0.x, mineure cassante), `deepmerge-ts` 8
  (majeure, CLI Prisma), `extract-zip` et `image-size` 2 (aucun correctif publié).
