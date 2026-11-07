import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { AutoCampaignsCron } from '../crons/auto-campaigns.cron';
import { EmailCampaignService } from '../../admin/email-campaign.service';
import { CAMPAIGNS } from './campaign-registry';

/**
 * Public des campagnes (#823) : un compte interne (test de l'équipe) reçoit les campagnes et les
 * e-mails de service comme un compte réel, pour que l'équipe voie les vrais envois ; un compte démo
 * ou ADMIN ne les reçoit jamais. Vérifié sur les deux chemins de sélection (cron et admin : liste,
 * envoi manuel), pour chaque campagne du registre.
 */

type Account = { isDemo: boolean; isInternal: boolean; role: string };
const ACCOUNTS: Record<string, Account> = {
  réel: { isDemo: false, isInternal: false, role: 'USER' },
  interne: { isDemo: false, isInternal: true, role: 'USER' },
  démo: { isDemo: true, isInternal: false, role: 'USER' },
  admin: { isDemo: false, isInternal: false, role: 'ADMIN' },
};

/**
 * Évalue le filtre « public » ajouté au segment. Toute clé inconnue fait échouer le test : un
 * nouveau critère de public doit être décidé ici, pas passer inaperçu.
 */
function audienceMatches(filter: Prisma.UserWhereInput, a: Account): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (key === 'isDemo' || key === 'isInternal') return a[key] === value;
    if (key === 'role') {
      const v = value as { not?: string; equals?: string };
      if (Object.keys(v).some((k) => k !== 'not')) throw new Error(`role : opérateur non géré ${JSON.stringify(v)}`);
      return a.role !== v.not;
    }
    throw new Error(`critère de public non prévu par ce test : ${key}`);
  });
}

/** Le filtre de public est le 2e terme de `{ AND: [segment, public] }`. */
function audienceOf(where: Prisma.UserWhereInput): Prisma.UserWhereInput {
  const and = where.AND as Prisma.UserWhereInput[];
  expect(and).toHaveLength(2);
  return and[1];
}

function expectAudience(filter: Prisma.UserWhereInput, label: string) {
  const selected = Object.fromEntries(Object.entries(ACCOUNTS).map(([name, a]) => [name, audienceMatches(filter, a)]));
  expect(selected, label).toEqual({ réel: true, interne: true, démo: false, admin: false });
}

beforeEach(() => {
  vi.stubEnv('ONBOARDING_SEQUENCE_START', '2026-11-01T00:00:00Z');
  vi.useFakeTimers({ toFake: ['setTimeout'] }); // pause entre deux envois manuels
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('public des campagnes : interne sélectionné, démo et ADMIN exclus', () => {
  it('cron : chaque campagne automatisée', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const cron = new AutoCampaignsCron(
      { user: { findMany } } as never,
      { allowedUsers: vi.fn(), dispatch: vi.fn() } as never,
      { get: (k: string) => (k === 'NODE_ENV' ? 'production' : undefined) } as never,
      { publicState: vi.fn().mockResolvedValue({ open: true, seatsLeft: 150, seatsTotal: 200 }) } as never,
    );
    await cron.run();

    const automated = CAMPAIGNS.filter((c) => c.automated);
    expect(automated.length).toBeGreaterThan(0);
    expect(findMany).toHaveBeenCalledTimes(automated.length); // une page vide par campagne
    findMany.mock.calls.forEach(([args], i) => expectAudience(audienceOf(args.where), `cron, campagne n° ${i + 1}`));
  });

  function makeService() {
    const prisma = {
      user: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      emailCampaignLog: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) },
      emailSend: { groupBy: vi.fn().mockResolvedValue([]) },
      $queryRaw: vi.fn().mockResolvedValue([{ sent: 0, connected: 0 }]),
      propFirm: { count: vi.fn().mockResolvedValue(0) },
    };
    const svc = new EmailCampaignService(
      prisma as never,
      { canSend: vi.fn(), dispatch: vi.fn(), buildUnsubUrl: vi.fn(() => 'u') } as never,
      { send: vi.fn() } as never,
      { publicState: vi.fn().mockResolvedValue({ open: true, seatsLeft: 150, seatsTotal: 200 }) } as never,
      { client: { get: vi.fn().mockResolvedValue(null), setex: vi.fn() } } as never,
    );
    return { svc, prisma };
  }

  it('admin, liste des campagnes : chaque campagne exposée, comptages compris', async () => {
    const { svc, prisma } = makeService();
    const list = await svc.listCampaigns();
    // Les campagnes absentes de l'admin (essai J+11 et fin d'essai) ne partent que par le cron,
    // couvert au test précédent.
    // (Les types de l'admin ne sont pas toujours les clés du registre : strategy_profile = profile_reminder.)
    const trial = CAMPAIGNS.filter((c) => c.key === 'trial_ending' || c.key === 'trial_ended');
    expect(trial.map((c) => c.automated)).toEqual([true, true]);
    expect(list.some((c) => c.type.startsWith('trial'))).toBe(false);
    expect(list).toHaveLength(CAMPAIGNS.length - trial.length);
    // Comptage du segment : `{ AND: [segment, public] }` ; les autres comptages l'emboîtent.
    const segmentCounts = prisma.user.count.mock.calls
      .map(([args]) => args.where as Prisma.UserWhereInput)
      .filter((w) => !('emailSends' in ((w.AND as Prisma.UserWhereInput[])[1] ?? {})) && !('marketingConsent' in ((w.AND as Prisma.UserWhereInput[])[1] ?? {})));
    expect(segmentCounts).toHaveLength(list.length);
    segmentCounts.forEach((w, i) => expectAudience(audienceOf(w), `liste admin, campagne n° ${i + 1}`));
  });

  it('admin, envoi manuel : même public que la liste', async () => {
    const { svc, prisma } = makeService();
    const run = svc.send('reengagement', 'admin-id');
    await vi.runAllTimersAsync();
    await run;
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expectAudience(audienceOf(prisma.user.findMany.mock.calls[0][0].where), 'envoi manuel');
  });
});
