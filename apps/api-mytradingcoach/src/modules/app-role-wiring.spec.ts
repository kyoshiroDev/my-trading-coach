/**
 * Câblage d'APP_ROLE (SCA-B6-01) : les listes de providers sont figées à l'import du module, on
 * réimporte donc chaque module avec l'environnement voulu.
 *
 * Seul le câblage est testé (`runsQueueProcessors` + la liste de providers du module) : les
 * classes que le module importe sont remplacées par des classes vides du MÊME nom. Sans ça, chaque
 * réimport rechargeait tout le graphe (IA, PDF, Stripe, Prisma…) : ~7 s seul, au-delà de 30 s
 * quand toute la suite tourne en parallèle, et un cas expiré continuait en arrière-plan en
 * débordant son APP_ROLE sur le cas suivant.
 */
import 'reflect-metadata';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MODULE_METADATA } from '@nestjs/common/constants';

const { stub } = vi.hoisted(() => ({
  /** Module factice qui exporte des classes vides portant les noms demandés. */
  stub: (...names: string[]) =>
    Object.fromEntries(names.map((n) => [n, Object.defineProperty(class {}, 'name', { value: n })])),
}));

// DebriefModule
vi.mock('./debrief/debrief.controller', () => stub('DebriefController'));
vi.mock('./debrief/debrief-admin.controller', () => stub('DebriefAdminController'));
vi.mock('./debrief/debrief.service', () => stub('DebriefService'));
vi.mock('./debrief/debrief.cron', () => stub('DebriefCron'));
vi.mock('./debrief/debrief.processor', () => stub('DebriefProcessor'));
vi.mock('./ai/ai.module', () => stub('AiModule'));
vi.mock('./analytics/analytics.module', () => stub('AnalyticsModule'));
vi.mock('./resend/resend.module', () => stub('ResendModule'));
vi.mock('./pdf/pdf.module', () => stub('PdfModule'));
vi.mock('./session/session.module', () => stub('SessionModule'));
vi.mock('./accounts/accounts.module', () => stub('AccountsModule'));
// StripeModule
vi.mock('../prisma/prisma.module', () => stub('PrismaModule'));
vi.mock('./discord/discord.module', () => stub('DiscordModule'));
vi.mock('./stripe/stripe.controller', () => stub('StripeController'));
vi.mock('./stripe/stripe.processor', () => stub('StripeProcessor'));
vi.mock('./stripe/stripe.client', () => ({ stripeClientProvider: { provide: 'STRIPE_CLIENT', useValue: null } }));
vi.mock('./stripe/stripe.helpers', () => ({ STRIPE_QUEUE: 'stripe' }));
vi.mock('./stripe/stripe-billing.service', () => stub('StripeBillingService'));
vi.mock('./stripe/stripe-coupon.service', () => stub('StripeCouponService'));
vi.mock('./stripe/stripe-customer.service', () => stub('StripeCustomerService'));
vi.mock('./stripe/stripe-referral.service', () => stub('StripeReferralService'));
vi.mock('./stripe/stripe-subscription.service', () => stub('StripeSubscriptionService'));
vi.mock('./stripe/stripe-webhook.service', () => stub('StripeWebhookService'));
vi.mock('./founder-offer/founder-offer.module', () => stub('FounderOfferModule'));
vi.mock('./partner-codes/partner-code.module', () => stub('PartnerCodeModule'));

async function providersOf(path: string, exportName: string, env: Record<string, string | undefined>): Promise<string[]> {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string);
  const mod = (await import(path))[exportName];
  const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, mod) ?? []) as Array<{ name?: string; provide?: unknown }>;
  return providers.map((p) => p.name ?? String(p.provide));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('processeurs BullMQ selon APP_ROLE', () => {
  it.each([
    ['./debrief/debrief.module', 'DebriefModule', 'DebriefProcessor'],
    ['./stripe/stripe.module', 'StripeModule', 'StripeProcessor'],
  ])('%s : présent en all / worker, absent en web', async (path, name, processor) => {
    expect(await providersOf(path, name, { APP_ROLE: '' })).toContain(processor);
    expect(await providersOf(path, name, { APP_ROLE: 'worker' })).toContain(processor);
    expect(await providersOf(path, name, { APP_ROLE: 'web' })).not.toContain(processor);
  });

  it('le reste du module ne dépend pas du rôle', async () => {
    const web = await providersOf('./stripe/stripe.module', 'StripeModule', { APP_ROLE: 'web' });
    const all = await providersOf('./stripe/stripe.module', 'StripeModule', { APP_ROLE: '' });
    expect(all.filter((p) => p !== 'StripeProcessor')).toEqual(web);
    expect(web).toContain('StripeWebhookService');
  });
});
