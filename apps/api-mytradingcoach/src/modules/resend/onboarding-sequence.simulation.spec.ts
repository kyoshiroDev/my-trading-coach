import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { matchWhere } from '@api/test/prisma-where';
import { EmailDispatchService } from './email-dispatch.service';
import { AutoCampaignsCron } from './crons/auto-campaigns.cron';

// Simulation de la suite d'onboarding sur 21 jours avec le VRAI cron, le VRAI registre et le VRAI
// EmailDispatchService (consentement, oneShot, plafond de 4 jours + tolérance d'une heure). Seule la
// base est en mémoire. Un passage par jour à 10 h (Paris) ; chaque envoi avance l'horloge de 2 s
// (un passage dure quelques secondes). Inscriptions à J0 9 h, avant le passage du jour.

const DAY = 24 * 3600e3;
const D0 = new Date('2026-11-02T08:00:00Z'); // lundi 2/11, 9 h à Paris
const at = (day: number, hourUtc = 8) => new Date(D0.getTime() + day * DAY + (hourUtc - 8) * 3600e3);
const runAt = (day: number) => at(day, 9); // 10 h à Paris (UTC+1 en novembre)

interface SimUser {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  marketingConsent: boolean;
  serviceEmailsOptOutAt: Date | null;
  unsubToken: string;
  plan: 'FREE';
  role: 'USER';
  isDemo: false;
  tradingStyle: null;
  discordId: null;
  stripeSubscriptionStatus: null;
  founderSeat: null;
  partnerRedemption: null;
  /** Événements datés : n'existent dans la base qu'à partir de leur date. */
  trades: { tradedAt: Date; createdAt: Date; pnl: number }[];
  brokerConnections: { status: 'CONNECTED'; createdAt: Date }[];
  tradingAccounts: { status: 'ACTIVE'; type: string; propFirmPlanId: string | null; planLinkChoice: null; createdAt: Date }[];
}

function profile(id: string, over: Partial<SimUser> = {}): SimUser {
  return {
    id, email: `${id}@test.com`, name: 'Alex', createdAt: D0, marketingConsent: true, serviceEmailsOptOutAt: null,
    unsubToken: `tok-${id}`, plan: 'FREE', role: 'USER', isDemo: false, tradingStyle: null, discordId: null,
    stripeSubscriptionStatus: null, founderSeat: null, partnerRedemption: null,
    trades: [], brokerConnections: [], tradingAccounts: [], ...over,
  };
}

const evalAccount = (createdAt: Date, propFirmPlanId: string | null = null) =>
  ({ status: 'ACTIVE' as const, type: 'EVALUATION', propFirmPlanId, planLinkChoice: null, createdAt });
/** Un trade par jour ouvré entre deux jours (inclus), visible dès son exécution. */
const dailyTrades = (from: number, to: number, importedOn?: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i)
    .filter((d) => ![5, 6].includes(d % 7)) // samedi / dimanche (D0 = lundi)
    .map((d) => ({ tradedAt: at(d, 15), createdAt: importedOn === undefined ? at(d, 15) : at(importedOn, 12), pnl: 120 }));

const PROFILES: SimUser[] = [
  // 1. S'inscrit, ne fait rien (onboarding passé : aucun compte).
  profile('p1-rien'),
  // 2. Tradovate le jour même (compte d'évaluation sans plan), trades synchronisés chaque jour ouvré.
  profile('p2-tradovate', {
    tradingAccounts: [evalAccount(at(0, 10))],
    brokerConnections: [{ status: 'CONNECTED', createdAt: at(0, 10) }],
    trades: dailyTrades(0, 20),
  }),
  // 3. Tradovate + firme et plan choisis le jour même, trade toute la première semaine.
  profile('p3-tradovate-plan', {
    tradingAccounts: [evalAccount(at(0, 10), 'apex-50k')],
    brokerConnections: [{ status: 'CONNECTED', createdAt: at(0, 10) }],
    trades: dailyTrades(0, 6),
  }),
  // 4. Import CSV (pas de Tradovate) sur un compte d'évaluation sans firme : historique importé à J0,
  //    puis les trades de J1-J4 importés à J5.
  profile('p4-csv', {
    tradingAccounts: [evalAccount(at(0, 10))],
    trades: [
      ...Array.from({ length: 10 }, (_, i) => ({ tradedAt: at(-20 + i, 15), createdAt: at(0, 11), pnl: -40 })),
      ...dailyTrades(1, 4, 5),
    ],
  }),
  // 5. Sans consentement marketing, compte d'évaluation créé à l'onboarding, rien d'autre.
  profile('p5-sans-consentement', { marketingConsent: false, tradingAccounts: [evalAccount(at(0, 10))] }),
  // 6. Ancien inscrit (il y a 2 mois), consentant, compte d'évaluation sans plan, aucun trade.
  profile('p6-ancien', { createdAt: at(-60), tradingAccounts: [evalAccount(at(-60))] }),
];

/** Vue de la base à l'instant `now` : seuls les événements déjà survenus existent. */
function snapshot(u: SimUser, now: Date, sends: Send[]) {
  return {
    ...u,
    trades: u.trades.filter((t) => t.createdAt <= now),
    brokerConnections: u.brokerConnections.filter((b) => b.createdAt <= now),
    tradingAccounts: u.tradingAccounts.filter((a) => a.createdAt <= now),
    emailSends: sends.filter((s) => s.userId === u.id),
  };
}

interface Send { userId: string; campaignKey: string; kind: string; sentAt: Date }

function simulate(users: SimUser[], days: number) {
  const sends: Send[] = [];
  const now = () => new Date();
  const prisma = {
    user: {
      findMany: vi.fn(async (args: { where: Record<string, unknown>; take: number; cursor?: { id: string } }) => {
        const rows = users
          .filter((u) => u.createdAt <= now())
          .map((u) => snapshot(u, now(), sends))
          .filter((u) => matchWhere(u, args.where))
          .sort((a, b) => a.id.localeCompare(b.id));
        const from = args.cursor ? rows.findIndex((r) => r.id === args.cursor!.id) + 1 : 0;
        return rows.slice(from, from + args.take);
      }),
      update: vi.fn(),
    },
    emailSend: {
      groupBy: vi.fn(async ({ where }: { where: { campaignKey?: string; kind?: { in: string[] }; userId: { in: string[] } } }) => {
        const last = new Map<string, Date>();
        for (const s of sends) {
          if (!where.userId.in.includes(s.userId)) continue;
          if (where.campaignKey && s.campaignKey !== where.campaignKey) continue;
          if (where.kind && !where.kind.in.includes(s.kind)) continue;
          if (!last.has(s.userId) || last.get(s.userId)! < s.sentAt) last.set(s.userId, s.sentAt);
        }
        return [...last].map(([userId, sentAt]) => ({ userId, _max: { sentAt } }));
      }),
      create: vi.fn(async ({ data }: { data: Omit<Send, 'sentAt'> }) => {
        sends.push({ ...data, sentAt: now() });
        vi.setSystemTime(now().getTime() + 2_000);
      }),
    },
    propFirm: { count: vi.fn(async () => 16) },
    // Seule requête brute du cron : le bilan J0-J7 (loadFirstWeek), recalculé ici en mémoire.
    $queryRaw: vi.fn(async (sql: Prisma.Sql) => {
      const ids = sql.values.filter((v): v is string => typeof v === 'string');
      return users
        .filter((u) => ids.includes(u.id))
        .map((u) => {
          const week = u.trades.filter(
            (t) => t.createdAt <= now() && t.tradedAt >= u.createdAt && t.tradedAt.getTime() < u.createdAt.getTime() + 7 * DAY,
          );
          const days = new Set(week.map((t) => t.tradedAt.toISOString().slice(0, 10))).size;
          return { userId: u.id, trades: week.length, days, net: week.reduce((s, t) => s + t.pnl, 0), currencies: ['USD'] };
        })
        .filter((r) => r.trades > 0);
    }),
  };
  const config = {
    get: (k: string) =>
      ({ NODE_ENV: 'production', MARKETING_COOLDOWN_DAYS: 4, FRONTEND_URL: 'https://app.test', API_URL: 'https://api.test' })[k],
  } as unknown as ConfigService;
  const resend = { send: vi.fn() };
  const dispatch = new EmailDispatchService(prisma as never, resend as never, config);
  const founders = { publicState: vi.fn(async () => ({ open: true, seatsLeft: 150, seatsTotal: 200 })) };
  const cron = new AutoCampaignsCron(prisma as never, dispatch, config, founders as never);

  return (async () => {
    for (let day = 1; day <= days; day++) {
      vi.setSystemTime(runAt(day));
      await cron.run();
    }
    const calendar: Record<string, string[]> = {};
    for (const u of users) {
      calendar[u.id] = sends
        .filter((s) => s.userId === u.id)
        .map((s) => `J${Math.floor((s.sentAt.getTime() - D0.getTime()) / DAY)} ${s.campaignKey}`);
    }
    return { calendar, sends, resend };
  })();
}

describe('suite d’onboarding : calendrier simulé des 6 profils sur 21 jours', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    Logger.overrideLogger(false); // un journal par passage : illisible sur 21 jours
    vi.stubEnv('ONBOARDING_SEQUENCE_START', '2026-11-01T00:00:00Z'); // mise en prod avant J0
  });
  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    Logger.overrideLogger(['log', 'error', 'warn', 'debug', 'verbose']);
  });

  it('jours d’envoi conformes, jamais deux e-mails à moins de 4 jours', async () => {
    const { calendar, sends } = await simulate(PROFILES, 21);

    expect(calendar).toEqual({
      'p1-rien': ['J1 connect_tradovate', 'J5 profile_reminder', 'J9 discord_invite', 'J13 founder_followup'],
      'p2-tradovate': [
        'J3 profile_reminder',
        'J7 prop_firm_rules', // plus prioritaire que le précédent : la tolérance évite J8
        'J11 first_week_recap',
        'J15 founder_followup',
        'J19 discord_invite',
      ],
      'p3-tradovate-plan': ['J3 profile_reminder', 'J7 first_week_recap', 'J11 founder_followup', 'J15 discord_invite'],
      'p4-csv': [
        'J3 profile_reminder',
        'J7 prop_firm_rules',
        'J11 first_week_recap',
        'J15 founder_followup',
        'J19 discord_invite',
      ],
      'p5-sans-consentement': ['J1 connect_tradovate', 'J5 prop_firm_rules'],
      'p6-ancien': [],
    });

    for (const id of Object.keys(calendar)) {
      const times = sends.filter((s) => s.userId === id).map((s) => s.sentAt.getTime());
      for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThan(4 * DAY - 3600e3);
    }
  });

  it('inscription après 10 h : tout part un jour plus tard', async () => {
    const late = profile('p1-tard', { createdAt: at(0, 14) });
    const { calendar } = await simulate([late], 21);
    expect(calendar['p1-tard']).toEqual([
      'J2 connect_tradovate',
      'J6 profile_reminder',
      'J10 discord_invite',
      'J14 founder_followup',
    ]);
  });

  it('se désinscrire des conseils coupe les e-mails de service, pas le marketing', async () => {
    const optOut = profile('p5-desinscrit', { serviceEmailsOptOutAt: at(0, 12), tradingAccounts: [evalAccount(at(0, 10))] });
    const { calendar } = await simulate([optOut], 21);
    expect(calendar['p5-desinscrit']).toEqual(['J3 profile_reminder', 'J7 discord_invite', 'J11 founder_followup']);
  });
});
