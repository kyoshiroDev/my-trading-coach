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

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

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
- `.env.example` versionné avec des valeurs vides — jamais les vraies valeurs

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

```typescript
// @nestjs/throttler v6+
ThrottlerModule.forRoot([{
  name: 'global',
  ttl: 60000,    // 1 minute
  limit: 60,     // 60 req/min par IP
}, {
  name: 'ai',
  ttl: 60000,
  limit: 20,     // 20 req/min sur routes IA
}])

// Sur les controllers IA
@UseGuards(ThrottlerGuard)
@Throttle({ ai: { limit: 20, ttl: 60000 } })
```
