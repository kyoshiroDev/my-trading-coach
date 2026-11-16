---
name: security
description: "À appeler pour vérifier un diff qui touche l'authentification, les JWT, l'OAuth broker ou Google, les guards, les permissions, les secrets, les variables d'environnement, le rate limiting ou des données personnelles."
tools: Read, Grep, Glob, Bash
---

# Agent Security — Auth, Guards, JWT, Variables d'env

## Vérification d'un diff

Appelé comme vérificateur : tu lis seulement le diff de ton domaine (`git diff origin/dev...HEAD -- apps/api-mytradingcoach libs/front/auth`), les règles de cet agent et, dans l'index en bas, les seules références utiles au diff. Pas les agents des autres domaines. Tu ne modifies rien. Chaque correction cite le fichier et la ligne, et la règle de cet agent (ou de sa référence) qu'elle applique : rien d'inventé.

1. Mots de passe : Argon2id (jamais Bcrypt).
2. Guards : `JwtAuthGuard` sur toute route protégée, `PremiumGuard` pour l'IA et les analytics avancés, `DemoReadOnlyGuard` laissé actif sur les mutations.
3. Tout `@Body()` est une classe DTO ; e-mail normalisé (`emailTransform`, `emailEquals`), jokers `_` et `%` échappés.
4. Rate limiting : limites dédiées sur l'auth, jamais de 429 sur les routes de santé, `trust proxy` à 1.
5. Tokens broker chiffrés (AES-256-GCM), mot de passe broker jamais vu, `state` OAuth signé.
6. Canaux temps réel authentifiés.
7. Webhook Stripe : signature vérifiée sur le corps brut.
8. Aucun secret en dur ni `.env` lu ; nouvelle variable documentée.
9. Rien de la liste « Ne jamais exposer » dans une réponse ou un log.
10. Helmet + CORS inchangés sans raison.
11. Nouvelle donnée personnelle ou nouveau traitement : politique de confidentialité à jour (`reference/security/donnees-perso.md`).
12. Dépendance ajoutée sans vulnérabilité connue.

Réponse, toujours ce format, court :
```
Domaine : security
Verdict : conforme | corrections nécessaires | bloquant
Corrections : liste numérotée (fichier:ligne, règle, correction)
Points pour le relecteur : ce qui sort de mon domaine ou demande un arbitrage
```
« bloquant » = règle non négociable violée (sécurité, argent, données, démo, prod) ; « corrections nécessaires » = écart à corriger avant push ; « conforme » = rien à corriger dans ton domaine.

---

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
// Hash : TOUJOURS via password-hashing.ts (argon2id, 19 Mio, t=2, p=1 — voir fin de fichier)
const hash = await hashPassword(password);

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
    // Réponse à la requête préalable gardée 10 min par le navigateur (perf, oct. 2026). Pas
    // d'effet sur l'autorisation : une origine hors CORS_ORIGINS reste refusée sur la réponse
    // réelle ; seul délai : un retrait d'origine met jusqu'à 10 min à couper ses requêtes préalables.
    maxAge: 600,
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

- **Défaut** (SCA-B3-03) : **300 requêtes / minute par utilisateur connecté** (compteur
  `user:<id>`), **60 / minute / IP** pour un anonyme (`defaultThrottleLimit`). Deux utilisateurs
  derrière la même IP ne partagent plus de compteur. **`JwtAuthGuard` passe AVANT le throttler**
  (`app.module.ts`) pour que `req.user` soit connu ; les routes `@Public` restent comptées par IP
  (+ empreinte d'e-mail). Surcharge par route : `@Throttle({ default: { ttl, limit } })` — sur une
  route authentifiée, elle compte désormais par utilisateur.
- **IP réelle** : `app.set('trust proxy', 1)` dans `main.ts` (un seul saut : Traefik). Sans lui,
  `req.ip` = IP du proxy → tous les users dans le même compteur. Ne jamais monter à `true`
  (le client pourrait forger `X-Forwarded-For`).
- **Compteurs dans Redis** (`common/throttler/redis-throttler.storage.ts`, script Lua atomique) :
  communs aux workers du cluster. Repli automatique en mémoire si Redis tombe (jamais bloquant).
- **Limites dédiées** : auth (login 10, register 5, forgot-password 3, reset-password 5,
  demo-login 20 / min), IA (insights, chat : 20 / min), Tradovate et routes publiques.
  Toute nouvelle route qui envoie un email ou coûte un appel IA reçoit son `@Throttle`.
- **Routes de santé** : une sonde d'uptime ou de déploiement ne doit jamais recevoir de 429 (le
  healthcheck Docker en `wget` passerait « unhealthy »).
  - `GET /api/health` (aucune entrée-sortie) : `@SkipAllThrottlers()`
    (`common/throttler/skip-all-throttlers.decorator.ts` : ni `default` ni `ip`), seule route sans limite.
    `@SkipThrottle()` sans argument ne saute que `default`.
  - `GET /api/health/ready` (Postgres + Redis, publique) : limite dédiée `READY_THROTTLE_LIMIT`
    = 600 / minute / IP, dix fois une sonde à 1/s, mais jamais martelable sans limite.
  - Limiteurs de l'app : `THROTTLERS` (`email-aware-throttler.guard.ts`).
  Verrouillé par `health-throttle.spec.ts` et `health-throttle.int-spec.ts`.

## Validation des entrées

- **Tout `@Body()` est une classe DTO** (class-validator). Un type inline
  (`@Body() body: { … }`) n'est PAS validé par le ValidationPipe : `whitelist` et
  `forbidNonWhitelisted` ne s'appliquent pas, et le corps arrive tel quel. C'est ce qui
  permettait d'écrire n'importe quelle colonne via `PATCH /session/:id` (corrigé).
- Ne jamais passer un DTO entier à `prisma.*.update({ data })` : recopier les champs autorisés.

### E-mails : insensibles à la casse (#999, S7 de l'audit #994)

- **Écriture** : tout DTO qui reçoit une adresse de compte porte `@Transform(emailTransform)`
  (`common/utils/email.util.ts` : espaces autour retirés, minuscules) avant `@IsEmail`. Inscription,
  connexion, mot de passe oublié, promotion et retrait ambassadeur. Google normalise déjà dans
  `google-id-token.verifier.ts`.
- **Lecture** : chercher un compte par e-mail avec `emailEquals(email)` dans un `findFirst`
  (`orderBy: { createdAt: 'asc' }`), jamais `findUnique({ where: { email } })` : les comptes d'avant
  le correctif peuvent garder des majuscules en base (2 en prod le 14/11, aucun doublon), et ne sont
  pas réécrits.
- **Piège Prisma** : `equals` + `mode: 'insensitive'` devient un `ILIKE` SANS échappement. `_` et `%`
  y sont des jokers : « a_b@x.com » retrouvait « axb@x.com » (vu sur une vraie base). Ne jamais
  écrire ce filtre à la main sur une valeur saisie : `emailEquals` échappe (`escapeLike`).
  Preuve : `email-case.int-spec.ts`.

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

---

## Détail déplacé (résumé)

- **Durcissements SCA** (argon2 OWASP, rate limiting par IP sur l'auth, `LOAD_TEST_KEY`, cache de l'utilisateur) : `reference/security/durcissements.md`.

---

## Index des références (`.claude/reference/`)

Contenu déplacé à l'identique le 2026-11-16. Lire un fichier seulement quand la tâche correspond à « quand le lire ».

| Fichier | Quand le lire |
|---|---|
| `security/donnees-perso.md` | données personnelles, politique de confidentialité, Stripe sans compte |
| `security/durcissements.md` | argon2, rate limiting IP, `LOAD_TEST_KEY`, cache de l'utilisateur |
| `commun/connexion-google.md` | connexion / inscription Google, OAuth, liaison de compte |
| `commun/liaison-discord.md` | liaison Discord par code |
| `commun/offre-fondateur.md` | offre fondateur, places, codes partenaires, route publique `/pricing/founder` |
| `commun/pgbouncer.md` | pool Postgres, PgBouncer, SCRAM |

## Texte d'utilisateur dans un e-mail HTML (S1 #1063, 2026-11-16)

Tout texte saisi par un utilisateur (nom à l'inscription, nom Google) inséré dans un gabarit d'e-mail
passe par `escapeHtml` / `greetingName` (`resend/templates/index.ts`) : jamais tel quel. L'aperçu admin
des campagnes rend ce HTML (nom du 1er destinataire réel) dans une `<iframe [srcdoc]>` en
`sandbox=""` (aucun script, origine opaque). Nom borné à 100 caractères (inscription, modale admin, Google).

## Filleuls vus par un parrain ou un ambassadeur (S2 #1063, 2026-11-16)

Un parrain ou un ambassadeur (tiers externe) ne voit de ses filleuls qu'un pseudo masqué
(`referral/mask-pseudo.ts`, 2 lettres + étoiles) : jamais l'id, le nom ni l'e-mail. `GET /ambassador/stats`
(vue ambassadeur) et le parrainage grand public appliquent la règle ; seule la vue admin
(`GET /admin/ambassadors/:id/stats`, ou `?userId=` pour un ADMIN) garde le détail.

## Routes qui envoient un e-mail ou un push à l'équipe (S3, S4 #1063)

Toujours un `@Throttle` dédié, et une limite `ip` quand la route est publique : la clé par défaut
(ip + empreinte de l'e-mail du corps) se contourne en changeant d'adresse. Candidature ambassadeur
publique : 5/min + `ip` 10/h ; connectée : 3/h.

