/**
 * Ciblage réel des e-mails de l'essai d'inscription (#769, B2) : les filtres passent dans Prisma, le
 * cron exclut démo et admin, et chaque e-mail ne part qu'une fois (oneShot, EmailSend).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import { createIntegrationApp, type ResendMock } from '../../../test/integration-app.helper';
import { PrismaService } from '../../../prisma/prisma.service';
import { AutoCampaignsCron } from '../crons/auto-campaigns.cron';
import { CAMPAIGNS_BY_KEY } from './campaign-registry';

const PREFIX = 'int-trial-mail-';
const H = 3_600_000;
let app: INestApplication;
let prisma: PrismaService;
let resend: ResendMock;

const mk = (tag: string, endInHours: number, over: Record<string, unknown> = {}) => {
  const end = new Date(Date.now() + endInHours * H);
  return prisma.user.create({
    data: {
      email: `${PREFIX}${tag}-${Date.now()}@test.local`,
      trialSource: 'SIGNUP', trialEndsAt: end, signupTrialEndsAt: end, trialUsed: true,
      ...over,
    },
  });
};

beforeAll(async () => {
  ({ app, resend } = await createIntegrationApp());
  prisma = app.get(PrismaService);
}, 120_000);

afterAll(async () => {
  await prisma?.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await app?.close().catch(() => undefined);
});

describe('e-mails de l’essai d’inscription : ciblage en base', () => {
  it('trial_ending et trial_ended visent les bons comptes ; démo, admin et réservation exclus ; une seule fois', async () => {
    const ending = await mk('ending', 50);
    const ended = await mk('ended', -20);
    const demo = await mk('demo', 50, { isDemo: true });
    const admin = await mk('admin', 50, { role: Role.ADMIN });
    const reserved = await mk('reserved', 50, { stripeSubscriptionStatus: 'trialing', plan: 'PREMIUM' });
    const ids = [ending.id, ended.id, demo.id, admin.id, reserved.id];

    for (const key of ['trial_ending', 'trial_ended']) {
      const rows = await prisma.user.findMany({
        where: { AND: [CAMPAIGNS_BY_KEY.get(key)!.segment(new Date()), { id: { in: ids } }] },
        select: { id: true },
      });
      expect(rows.map((r) => r.id).sort(), key).toEqual(
        (key === 'trial_ending' ? [ending.id, demo.id, admin.id] : [ended.id]).sort(),
      );
    }

    // Le cron exclut démo et admin (prod seulement : on force NODE_ENV le temps du passage).
    const env = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      const cron = app.get(AutoCampaignsCron);
      (cron as unknown as { config: { get: (k: string) => string | undefined } }).config.get = (k: string) =>
        k === 'NODE_ENV' ? 'production' : process.env[k];
      await cron.run();
      await cron.run(); // second passage : rien de plus (oneShot)
    } finally {
      process.env['NODE_ENV'] = env;
    }
    const sends = await prisma.emailSend.findMany({ where: { userId: { in: ids } }, select: { userId: true, campaignKey: true } });
    expect(sends.map((s) => `${s.userId === ending.id ? 'ending' : s.userId === ended.id ? 'ended' : 'autre'}:${s.campaignKey}`).sort())
      .toEqual(['ended:trial_ended', 'ending:trial_ending']);
    expect(resend.send).toHaveBeenCalled();
  }, 60_000);
});
