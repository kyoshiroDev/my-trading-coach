/**
 * PROMPT-176 — règle de coexistence du parrainage, testée de bout en bout
 * sur la vraie stack : HTTP + signature Stripe + BullMQ + Postgres.
 *
 *   parrain AMBASSADOR → commission cash 20 %, JAMAIS de mois offert
 *   parrain USER       → mois offert (ReferralReward), JAMAIS de commission
 *   auto-parrainage    → ni l'un ni l'autre
 *
 * Ce que ça ajoute aux specs unitaires (`stripe-referral.service.spec.ts`, qui
 * couvrent déjà ces branches avec Prisma mocké) : la vérification de signature,
 * le passage réel par la file BullMQ, et les écritures réellement acceptées par
 * le schéma. Un mock ne dit rien de tout ça.
 *
 * AUCUN compte Stripe nécessaire :
 *  - le test SIGNE lui-même l'événement avec `STRIPE_WEBHOOK_SECRET`, que l'API
 *    utilise pour vérifier — les deux côtés partagent la même valeur ;
 *  - la branche « mois offert » crée le `ReferralReward` en PENDING AVANT tout
 *    appel Stripe, et `resolveFreeMonthCents` échoue en silence sans clé valide.
 *
 * ⚠️ L'événement déclencheur est `invoice.payment_succeeded`, pas
 * `checkout.session.completed` : c'est lui qui appelle `processReferral`.
 *
 * ⚠️ EN LOCAL : arrêter toute API lancée à côté avant de jouer cette suite. Un autre
 * process branché sur le MÊME Redis consomme la file « stripe » et traite les jobs
 * du test avec SON code — les assertions passent alors au vert sans rien prouver.
 * Vérifié : sabotage de `processReferral` non détecté tant qu'une API tournait.
 * En CI le problème ne se pose pas, il n'y a qu'un process.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Stripe from 'stripe';
import { Role } from '@prisma/client';
import { AppModule } from '../../app/app.module';
import { PrismaService } from '../../prisma/prisma.service';

const PREFIX = 'int-referral-';
const WEBHOOK_SECRET = process.env['STRIPE_WEBHOOK_SECRET'] ?? 'whsec_integration_test';

let app: INestApplication;
let prisma: PrismaService;
let baseUrl: string;

/** Suffixe unique : le job peut rejouer sans collision d'email ni de code. */
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

async function createUser(args: {
  suffix: string;
  kind: 'parrain' | 'filleul';
  role?: Role;
  referralCode?: string;
  referredBy?: string;
  stripeCustomerId?: string;
}) {
  return prisma.user.create({
    data: {
      email: `${PREFIX}${args.kind}-${args.suffix}@test.local`,
      password: 'int-test-no-login',
      name: `Int ${args.kind}`,
      role: args.role ?? Role.USER,
      referralCode: args.referralCode ?? null,
      referredBy: args.referredBy ?? null,
      stripeCustomerId: args.stripeCustomerId ?? null,
    },
    select: { id: true, email: true },
  });
}

/** Poste un `invoice.payment_succeeded` SIGNÉ sur le webhook, comme le ferait Stripe. */
async function postSignedInvoicePaid(args: {
  stripeCustomerId: string;
  subscriptionId: string;
  amountPaidCents: number;
}) {
  const event = {
    id: `evt_int_${uid()}`,
    object: 'event',
    created: Math.floor(Date.now() / 1000),
    type: 'invoice.payment_succeeded',
    livemode: false,
    data: {
      object: {
        id: `in_int_${uid()}`,
        object: 'invoice',
        customer: args.stripeCustomerId,
        amount_paid: args.amountPaidCents,
        currency: 'eur',
        parent: {
          type: 'subscription_details',
          subscription_details: { subscription: args.subscriptionId },
        },
      },
    },
  };

  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });

  const res = await fetch(`${baseUrl}/api/billing/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body: payload,
  });
  expect(
    res.ok,
    `Webhook refusé (${res.status}) : STRIPE_WEBHOOK_SECRET de l'API et du test doivent être identiques`,
  ).toBe(true);
}

/**
 * Attend qu'une condition devienne vraie. Le webhook répond avant traitement
 * (il enqueue dans BullMQ), donc un `2xx` ne prouve rien : il faut sonder la base.
 */
async function waitFor<T>(
  probe: () => Promise<T | null>,
  what: string,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const got = await probe();
    if (got) return got;
    if (Date.now() >= deadline) {
      throw new Error(
        `${what} : rien après ${timeoutMs / 1000}s. Redis tourne-t-il et le worker BullMQ ` +
          `« stripe » consomme-t-il la file ? handleWebhook ne fait qu'enqueuer.`,
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Laisse la file traiter, pour les cas où l'on attend qu'il ne se passe RIEN. */
const settle = () => new Promise((r) => setTimeout(r, 6_000));

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ rawBody: true });
  app.setGlobalPrefix('api');
  await app.init();
  await app.listen(0);
  baseUrl = await app.getUrl();
  prisma = app.get(PrismaService);
}, 120_000);

afterAll(async () => {
  if (prisma) {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: PREFIX } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    if (ids.length) {
      await prisma.referralCommission.deleteMany({
        where: { OR: [{ ambassadorId: { in: ids } }, { referredUserId: { in: ids } }] },
      });
      await prisma.referralReward.deleteMany({
        where: { OR: [{ parrainId: { in: ids } }, { filleulId: { in: ids } }] },
      });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
  }
  // `app.close()` déclenche RedisService.onModuleDestroy → client.quit(), qui jette
  // « Stream isn't writeable » quand BullMQ a déjà fermé la connexion partagée.
  // Bruit d'extinction sans rapport avec ce qui est testé : on ne fait pas échouer
  // la suite dessus (les assertions, elles, ont déjà tranché).
  await app?.close().catch(() => undefined);
});

describe('Coexistence parrainage : le rôle du parrain décide de la récompense', () => {
  it('parrain AMBASSADOR → commission 20 %, AUCUN mois offert', async () => {
    const s = uid();
    const code = `INTAMB${s}`.toUpperCase();
    const customerId = `cus_int_amb_${s}`;

    const parrain = await createUser({ suffix: s, kind: 'parrain', role: Role.AMBASSADOR, referralCode: code });
    const filleul = await createUser({ suffix: s, kind: 'filleul', referredBy: code, stripeCustomerId: customerId });

    await postSignedInvoicePaid({
      stripeCustomerId: customerId,
      subscriptionId: `sub_int_amb_${s}`,
      amountPaidCents: 4900,
    });

    const commission = await waitFor(
      () => prisma.referralCommission.findFirst({ where: { ambassadorId: parrain.id } }),
      'Commission ambassadeur',
    );

    expect(commission.amount).toBeCloseTo(9.8, 2); // 20 % de 49 €
    expect(commission.referredUserId).toBe(filleul.id);
    expect(commission.status).toBe('pending');

    // Le cœur de la règle : un ambassadeur ne touche JAMAIS de mois offert.
    const reward = await prisma.referralReward.findFirst({ where: { parrainId: parrain.id } });
    expect(reward, 'Un ambassadeur ne doit jamais recevoir de mois offert').toBeNull();
  });

  it('parrain USER normal → mois offert, AUCUNE commission', async () => {
    const s = uid();
    const code = `INTNRM${s}`.toUpperCase();
    const customerId = `cus_int_nrm_${s}`;

    const parrain = await createUser({ suffix: s, kind: 'parrain', role: Role.USER, referralCode: code });
    const filleul = await createUser({ suffix: s, kind: 'filleul', referredBy: code, stripeCustomerId: customerId });

    await postSignedInvoicePaid({
      stripeCustomerId: customerId,
      subscriptionId: `sub_int_nrm_${s}`,
      amountPaidCents: 4900,
    });

    const reward = await waitFor(
      () => prisma.referralReward.findFirst({ where: { parrainId: parrain.id } }),
      'Mois offert du parrain normal',
    );

    expect(reward.filleulId).toBe(filleul.id);
    // Sans clé Stripe exploitable, le crédit n'est pas chiffré : la ligne reste
    // PENDING et visible dans « mois à appliquer » côté admin. C'est le comportement
    // attendu, pas un échec.
    expect(['PENDING', 'APPLIED']).toContain(reward.status);

    // Le cœur de la règle : un parrain normal ne touche JAMAIS les 20 %.
    const commission = await prisma.referralCommission.findFirst({
      where: { ambassadorId: parrain.id },
    });
    expect(commission, 'Un parrain normal ne doit jamais toucher de commission').toBeNull();
  });

  it('auto-parrainage → ni commission ni mois offert', async () => {
    const s = uid();
    const code = `INTSELF${s}`.toUpperCase();
    const customerId = `cus_int_self_${s}`;

    // Le même utilisateur est son propre parrain.
    const self = await createUser({
      suffix: s,
      kind: 'parrain',
      role: Role.AMBASSADOR,
      referralCode: code,
      referredBy: code,
      stripeCustomerId: customerId,
    });

    await postSignedInvoicePaid({
      stripeCustomerId: customerId,
      subscriptionId: `sub_int_self_${s}`,
      amountPaidCents: 4900,
    });

    await settle();

    expect(
      await prisma.referralCommission.findFirst({ where: { ambassadorId: self.id } }),
      'Auto-parrainage : aucune commission',
    ).toBeNull();
    expect(
      await prisma.referralReward.findFirst({ where: { parrainId: self.id } }),
      'Auto-parrainage : aucun mois offert',
    ).toBeNull();
  });
});
