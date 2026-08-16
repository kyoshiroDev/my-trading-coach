/**
 * Helpers du parcours de parrainage e2e : préparation de l'ambassadeur et du
 * filleul, appels API, et attente robuste de la commission créée par le webhook.
 *
 * L'ambassadeur est créé par le VRAI `POST /api/auth/register` (donc un vrai hash
 * argon2, il peut se connecter et lire ses propres stats), puis promu AMBASSADOR
 * via Prisma. On évite ainsi d'avoir à provisionner un compte ADMIN juste pour
 * appeler `POST /api/ambassador/admin/promote`.
 *
 * Tout ce que le run crée est préfixé `e2e-referral-` + un suffixe unique, et
 * supprimé en fin de test : le test est rejouable sans collision.
 */
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Défaut aligné sur `environments/environment.ts` (config dev par défaut du front),
// qui pointe sur le port 3001 — et non 3000 comme l'indique encore `angular.md`.
export const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3001/api';
export const TEST_PASSWORD = 'TestPassword123!';

const PREFIX = 'e2e-referral-';

let prisma: PrismaClient | null = null;
let pool: Pool | null = null;

/**
 * Client Prisma construit comme celui de l'API : driver adapter `PrismaPg` sur un
 * pool `pg`. En Prisma 7, `schema.prisma` ne porte que le `provider` (l'URL vit
 * dans `prisma.config.ts`, côté CLI uniquement) — un `new PrismaClient()` nu
 * échoue donc au runtime avec « needs to be constructed with a non-empty, valid
 * PrismaClientOptions ».
 */
export function db(): PrismaClient {
  if (!prisma) {
    pool = new Pool({ connectionString: process.env['DATABASE_URL'], max: 5 });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({
      adapter,
    } as ConstructorParameters<typeof PrismaClient>[0]);
  }
  return prisma;
}

export async function closeDb(): Promise<void> {
  await prisma?.$disconnect();
  await pool?.end();
  prisma = null;
  pool = null;
}

/**
 * Identité unique par run : rejouable sans collision d'email ni de code.
 *
 * Base 36 et non un timestamp décimal : `RegisterDto.referralCode` est plafonné à
 * 20 caractères (`@MaxLength(20)`), et `E2EAMB` + timestamp décimal les dépassait
 * → 400 à l'inscription du filleul. Ici : 6 + ~11 = ~17 caractères.
 */
export function uniqueSuffix(): string {
  const ts = Date.now().toString(36);
  const rnd = Math.floor(Math.random() * 46_655).toString(36); // ≤ 3 caractères
  return `${ts}${rnd}`;
}

export function ambassadorEmail(suffix: string): string {
  return `${PREFIX}ambassador-${suffix}@test.local`;
}

export function filleulEmail(suffix: string): string {
  return `${PREFIX}filleul-${suffix}@test.local`;
}

// ── Appels API ────────────────────────────────────────────────────────────────

async function api<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...rest } = init;
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`API ${init.method ?? 'GET'} ${path} → ${res.status} : ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

interface AuthResponse {
  data: { access_token: string; user: { id: string; email: string } };
}

export async function registerUser(args: {
  email: string;
  name: string;
  referralCode?: string;
}): Promise<{ id: string; token: string }> {
  const body = await api<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: args.email,
      password: TEST_PASSWORD,
      name: args.name,
      ...(args.referralCode ? { referralCode: args.referralCode } : {}),
    }),
  });
  return { id: body.data.user.id, token: body.data.access_token };
}

export async function loginUser(email: string): Promise<string> {
  const body = await api<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  return body.data.access_token;
}

export interface AmbassadorStats {
  referralCode: string;
  total: number;
  premium: number;
  totalEarned: number;
  pendingPayout: number;
  earningsByMonth: Record<string, number>;
}

export function getAmbassadorStats(token: string): Promise<{ data: AmbassadorStats }> {
  return api<{ data: AmbassadorStats }>('/ambassador/stats', { token });
}

/** Crée la session Stripe Checkout (attache aussi le stripeCustomerId au filleul). */
export function createCheckout(
  token: string,
  plan: 'premium_monthly' | 'premium_yearly' = 'premium_monthly',
): Promise<{ data: { url: string } }> {
  return api<{ data: { url: string } }>('/billing/checkout', {
    method: 'POST',
    token,
    body: JSON.stringify({ plan }),
  });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

export interface Ambassador {
  id: string;
  email: string;
  referralCode: string;
  token: string;
}

/**
 * Inscrit un utilisateur puis le promeut AMBASSADOR avec un code connu.
 *
 * Le rôle AMBASSADOR est indispensable : sans lui, `processReferral` part sur la
 * branche « mois offert » (`grantReferralFreeMonth`) et ne crée AUCUNE commission.
 */
export async function createAmbassador(suffix: string): Promise<Ambassador> {
  const email = ambassadorEmail(suffix);
  const { id, token } = await registerUser({ email, name: 'Ambassadeur E2E' });

  // Code en MAJUSCULES : `register` fait `.toUpperCase()` avant le lookup.
  const referralCode = `E2EAMB${suffix}`.toUpperCase();
  await db().user.update({
    where: { id },
    data: { role: Role.AMBASSADOR, referralCode, onboardingCompleted: true },
  });

  return { id, email, referralCode, token };
}

// ── Attente de la commission ──────────────────────────────────────────────────

export interface CommissionRow {
  id: string;
  ambassadorId: string;
  referredUserId: string;
  amount: number;
  subscriptionId: string;
  period: string;
  status: string;
}

/**
 * Attend qu'une commission apparaisse pour cet ambassadeur.
 *
 * Polling, jamais de `sleep` fixe. Deux niveaux d'asynchronisme se cumulent :
 *   1. la livraison du webhook (via `stripe listen` en mode `ui`) ;
 *   2. le traitement lui-même — `handleWebhook` se contente de VALIDER la signature
 *      puis d'ENQUEUER dans BullMQ ; c'est le `StripeProcessor` qui écrit la
 *      commission. Sans Redis ni worker, le webhook répond 200 et rien n'arrive.
 *
 * En cas d'expiration, le message dit quoi vérifier : un timeout opaque sur une
 * chaîne à cinq maillons ne se diagnostique pas, et laisserait croire à un bug produit.
 */
export async function waitForCommission(args: {
  ambassadorId: string;
  mode: 'ui' | 'webhook';
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<CommissionRow> {
  const { ambassadorId, mode, timeoutMs = 60_000, intervalMs = 1_000 } = args;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const row = await db().referralCommission.findFirst({
      where: { ambassadorId },
      orderBy: { createdAt: 'desc' },
    });
    if (row) return row as CommissionRow;
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `Aucune ReferralCommission pour l'ambassadeur ${ambassadorId} après ${timeoutMs / 1000}s.\n` +
      (mode === 'ui'
        ? 'Mode UI : le webhook Stripe n\'a probablement pas été livré. ' +
          '`stripe listen --forward-to http://localhost:3000/api/billing/webhook` est-il lancé, ' +
          'et son `whsec_…` est-il bien dans STRIPE_WEBHOOK_SECRET de l\'API ?\n'
        : 'Mode webhook : l\'événement signé a été accepté (HTTP 200) mais rien n\'a été écrit.\n') +
      'À vérifier dans l\'ordre :\n' +
      '  1. Redis tourne et le worker BullMQ « stripe » consomme la queue — ' +
      'handleWebhook ne fait qu\'enqueuer, c\'est StripeProcessor qui écrit la commission ;\n' +
      '  2. le filleul a bien un stripeCustomerId et un referredBy ;\n' +
      '  3. l\'ambassadeur a bien le rôle AMBASSADOR (sinon : branche « mois offert », zéro commission).\n' +
      'Ce message signale un problème d\'infra de test autant qu\'un éventuel bug produit.',
  );
}

// ── Nettoyage ─────────────────────────────────────────────────────────────────

/**
 * Supprime tout ce que ce run a créé. Les rows enfants de User (trades, setups…)
 * partent en cascade, mais PAS ReferralCommission ni ReferralReward, dont les
 * relations n'ont pas d'`onDelete: Cascade` : on les supprime explicitement.
 */
export async function cleanup(suffix: string): Promise<void> {
  const p = db();
  const users = await p.user.findMany({
    where: { email: { contains: `${PREFIX}`, mode: 'insensitive' } },
    select: { id: true, email: true },
  });
  const ids = users.filter((u) => u.email.includes(suffix)).map((u) => u.id);
  if (!ids.length) return;

  await p.referralCommission.deleteMany({
    where: { OR: [{ ambassadorId: { in: ids } }, { referredUserId: { in: ids } }] },
  });
  await p.referralReward.deleteMany({
    where: { OR: [{ parrainId: { in: ids } }, { filleulId: { in: ids } }] },
  });
  await p.user.deleteMany({ where: { id: { in: ids } } });
}
