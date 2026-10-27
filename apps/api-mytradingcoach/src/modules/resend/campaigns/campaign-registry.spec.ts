import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { matchWhere } from '@api/test/prisma-where';
import { CAMPAIGNS, CAMPAIGNS_BY_KEY, loadFirstWeek, parisDaysUntil, type CampaignLoadDeps } from './campaign-registry';

// Suite d'onboarding (oct. 2026) : ciblage RÉEL de chaque campagne automatique (segments évalués en
// mémoire), bornes d'âge, date de démarrage et états qui bloquent un envoi.

const DAY = 24 * 3600e3;
const NOW = new Date('2026-11-20T09:00:00Z');
const START = '2026-10-01T00:00:00Z'; // avant toutes les fenêtres testées
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY);

type User = Record<string, unknown>;

/** Inscrit FREE « favorable » à toutes les campagnes, sauf ce que le test change. */
function user(over: User = {}): User {
  return {
    createdAt: daysAgo(5),
    plan: 'FREE',
    role: 'USER',
    isDemo: false,
    tradingStyle: null,
    discordId: null,
    stripeSubscriptionStatus: null,
    trialEndsAt: null,
    founderSeat: null,
    partnerRedemption: null,
    trades: [],
    brokerConnections: [],
    tradingAccounts: [],
    emailSends: [],
    ...over,
  };
}

const evalAccount = (over: User = {}) => ({
  status: 'ACTIVE',
  type: 'EVALUATION',
  propFirmPlanId: null,
  planLinkChoice: null,
  ...over,
});

const matches = (key: string, u: User) => matchWhere(u, CAMPAIGNS_BY_KEY.get(key)!.segment(NOW) as User);

beforeEach(() => {
  vi.stubEnv('ONBOARDING_SEQUENCE_START', START);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('registre : suite automatique', () => {
  it('priorités, types et consentement validés', () => {
    const auto = CAMPAIGNS.filter((c) => c.automated).sort((a, b) => b.priority - a.priority);
    expect(auto.map((c) => [c.key, c.priority, c.kind, c.requiresConsent])).toEqual([
      ['trial_ending', 120, 'service', false],
      ['trial_ended', 110, 'service', false],
      ['connect_tradovate', 100, 'service', false],
      ['prop_firm_rules', 90, 'service', false],
      ['first_week_recap', 80, 'marketing', true],
      ['founder_followup', 60, 'marketing', true],
      ['profile_reminder', 45, 'marketing', true],
      ['discord_invite', 40, 'marketing', true],
    ]);
    expect(auto.every((c) => c.recurringCooldownDays === undefined)).toBe(true); // tous oneShot
  });

  it('first_trade_nudge sort du cron (gardée pour l’admin)', () => {
    expect(CAMPAIGNS_BY_KEY.get('first_trade_nudge')).toMatchObject({ automated: false });
  });

  it('toute campagne automatique a une borne basse ET haute (inscription, ou fin de l’essai pour #769)', () => {
    for (const c of CAMPAIGNS.filter((x) => x.automated)) {
      const json = JSON.stringify(c.segment(NOW));
      expect(json, c.key).toMatch(
        /"createdAt":\{"gte":"[^"]+","lte":"[^"]+"\}|"signupTrialEndsAt":\{"(gt|gte)":"[^"]+","lte":"[^"]+"\}/,
      );
    }
  });

  it('un ancien inscrit (2 mois) ne reçoit rien, même dans l’état le plus favorable', () => {
    const old = user({
      createdAt: daysAgo(60),
      trades: [{}],
      tradingAccounts: [evalAccount()],
    });
    for (const c of CAMPAIGNS.filter((x) => x.automated)) expect(matches(c.key, old), c.key).toBe(false);
  });

  it('un inscrit de moins de 24 h ne reçoit rien', () => {
    const fresh = user({ createdAt: new Date(NOW.getTime() - 23 * 3600e3) });
    for (const c of CAMPAIGNS.filter((x) => x.automated)) expect(matches(c.key, fresh), c.key).toBe(false);
  });
});

describe('fenêtres d’âge (bornes comprises)', () => {
  it.each([
    ['connect_tradovate', 1, 14, {}],
    ['prop_firm_rules', 4, 21, { tradingAccounts: [evalAccount()] }],
    ['first_week_recap', 7, 14, { trades: [{}] }],
    ['founder_followup', 10, 30, {}],
    ['profile_reminder', 3, 14, {}],
    ['discord_invite', 5, 21, {}],
  ] as const)('%s : de J+%i à J+%i', (key, min, max, extra) => {
    const at = (ms: number) => matches(key, user({ ...extra, createdAt: new Date(NOW.getTime() - ms) }));
    expect(at(min * DAY - 60e3)).toBe(false);
    expect(at(min * DAY)).toBe(true);
    expect(at(max * DAY)).toBe(true);
    expect(at(max * DAY + 60e3)).toBe(false);
  });
});

describe('date de démarrage (ONBOARDING_SEQUENCE_START)', () => {
  const NEW_KEYS = ['connect_tradovate', 'prop_firm_rules', 'first_week_recap', 'founder_followup'];
  const eligible = (createdAt: Date) =>
    user({ createdAt, trades: [], tradingAccounts: [evalAccount()] });

  it('inscrit avant la date : exclu des nouvelles campagnes même dans la fenêtre', () => {
    vi.stubEnv('ONBOARDING_SEQUENCE_START', daysAgo(2).toISOString());
    expect(matches('connect_tradovate', eligible(daysAgo(3)))).toBe(false);
    expect(matches('connect_tradovate', eligible(daysAgo(1)))).toBe(true);
  });

  it('absente ou invalide : les nouvelles campagnes ne ciblent personne', () => {
    for (const value of ['', 'pas-une-date']) {
      vi.stubEnv('ONBOARDING_SEQUENCE_START', value);
      for (const key of NEW_KEYS) {
        const u = user({ createdAt: daysAgo(12), trades: [{}], tradingAccounts: [evalAccount()] });
        expect(matches(key, u), key).toBe(false);
      }
    }
  });

  it('profile_reminder et discord_invite gardent leur ciblage sans date (fenêtre seulement)', () => {
    vi.stubEnv('ONBOARDING_SEQUENCE_START', '');
    expect(matches('profile_reminder', user({ createdAt: daysAgo(4) }))).toBe(true);
    expect(matches('discord_invite', user({ createdAt: daysAgo(6) }))).toBe(true);
  });
});

describe('états qui bloquent un envoi', () => {
  it('connect_tradovate : connexion active ou trade → rien ; connexion à refaire → envoyé', () => {
    expect(matches('connect_tradovate', user())).toBe(true);
    expect(matches('connect_tradovate', user({ brokerConnections: [{ status: 'CONNECTED' }] }))).toBe(false);
    expect(matches('connect_tradovate', user({ brokerConnections: [{ status: 'NEEDS_RECONNECT' }] }))).toBe(true);
    expect(matches('connect_tradovate', user({ trades: [{}] }))).toBe(false); // import CSV ou saisie
  });

  it('prop_firm_rules : seulement un compte prop actif sans plan ni réponse « perso / hors catalogue »', () => {
    const p = (acc: User) => matches('prop_firm_rules', user({ tradingAccounts: [acc] }));
    expect(p(evalAccount())).toBe(true);
    expect(p(evalAccount({ type: 'FUNDED' }))).toBe(true);
    expect(p(evalAccount({ planLinkChoice: 'LATER' }))).toBe(true);
    expect(p(evalAccount({ propFirmPlanId: 'apex-50k' }))).toBe(false); // firme déjà choisie
    expect(p(evalAccount({ type: 'PERSONAL' }))).toBe(false);
    expect(p(evalAccount({ type: 'DEMO' }))).toBe(false);
    expect(p(evalAccount({ planLinkChoice: 'PERSONAL' }))).toBe(false);
    expect(p(evalAccount({ planLinkChoice: 'UNLISTED' }))).toBe(false);
    expect(p(evalAccount({ status: 'ARCHIVED' }))).toBe(false);
    expect(matches('prop_firm_rules', user())).toBe(false); // aucun compte
  });

  it('first_week_recap : FREE avec au moins un trade', () => {
    const base = { createdAt: daysAgo(8), trades: [{}] };
    expect(matches('first_week_recap', user(base))).toBe(true);
    expect(matches('first_week_recap', user({ ...base, plan: 'PREMIUM' }))).toBe(false);
    expect(matches('first_week_recap', user({ ...base, trades: [] }))).toBe(false);
  });

  it('founder_followup : mêmes exclusions que founder_launch, FREE, sans founder_launch reçu', () => {
    const base = { createdAt: daysAgo(11) };
    const f = (over: User) => matches('founder_followup', user({ ...base, ...over }));
    expect(f({})).toBe(true);
    expect(f({ stripeSubscriptionStatus: 'canceled' })).toBe(true);
    expect(f({ stripeSubscriptionStatus: 'active' })).toBe(false); // abonné
    expect(f({ stripeSubscriptionStatus: 'past_due' })).toBe(false);
    expect(f({ plan: 'PREMIUM' })).toBe(false);
    expect(f({ founderSeat: { number: 12 } })).toBe(false); // déjà fondateur
    expect(f({ partnerRedemption: { status: 'ACTIVE' } })).toBe(false);
    expect(f({ role: 'BETA_TESTER' })).toBe(false);
    expect(f({ emailSends: [{ campaignKey: 'founder_launch' }] })).toBe(false);
    expect(f({ emailSends: [{ campaignKey: 'discord_invite' }] })).toBe(true);
  });
});

describe('e-mails de l’essai d’inscription (#769, B2)', () => {
  const HOUR = 3600e3;
  const trialUser = (endsInHours: number, over: User = {}) => {
    const end = new Date(NOW.getTime() + endsInHours * HOUR);
    return user({ createdAt: daysAgo(12), trialSource: 'SIGNUP', signupTrialEndsAt: end, trialEndsAt: end, ...over });
  };

  it('trial_ending : 3 jours avant la fin au plus, jamais après ; essai prolongé par l’admin, abonné ou réservé : rien', () => {
    expect(matches('trial_ending', trialUser(71))).toBe(true);
    expect(matches('trial_ending', trialUser(2))).toBe(true);
    expect(matches('trial_ending', trialUser(73))).toBe(false); // trop tôt
    expect(matches('trial_ending', trialUser(-1))).toBe(false); // déjà fini
    expect(matches('trial_ending', trialUser(48, { trialSource: 'ADMIN' }))).toBe(false);
    expect(matches('trial_ending', trialUser(48, { trialEndsAt: new Date(NOW.getTime() + 30 * 86_400_000) }))).toBe(false);
    expect(matches('trial_ending', trialUser(48, { stripeSubscriptionStatus: 'trialing' }))).toBe(false); // réservation fondateur
    expect(matches('trial_ending', trialUser(48, { stripeSubscriptionStatus: 'active' }))).toBe(false);
  });

  it('trial_ended : du lendemain de la fin à J+6, en gratuit seulement', () => {
    expect(matches('trial_ended', trialUser(-16))).toBe(true);
    expect(matches('trial_ended', trialUser(-5 * 24))).toBe(true);
    expect(matches('trial_ended', trialUser(-10))).toBe(false); // trop tôt (même jour que la fin)
    expect(matches('trial_ended', trialUser(-7 * 24))).toBe(false); // trop tard
    expect(matches('trial_ended', trialUser(-24, { plan: 'PREMIUM', stripeSubscriptionStatus: 'active' }))).toBe(false);
    expect(matches('trial_ended', trialUser(-24, { trialSource: 'ADMIN' }))).toBe(false);
  });

  it('plafond respecté : l’e-mail de fin part au plus tôt 4 jours après J+11 sur le passage de 10 h', () => {
    // Fin à 09:00 le 14e jour : J+11 part le 11e jour à 10:00 (71 h avant), la fin le 15e jour à 10:00.
    const end = new Date('2026-11-16T08:00:00Z'); // 09:00 Paris
    const j11 = new Date('2026-11-13T09:00:00Z'); // 10:00 Paris
    const fin = new Date('2026-11-17T09:00:00Z');
    const u = user({ createdAt: new Date('2026-11-02T08:00:00Z'), trialSource: 'SIGNUP', signupTrialEndsAt: end, trialEndsAt: end });
    expect(matchWhere(u, CAMPAIGNS_BY_KEY.get('trial_ending')!.segment(j11) as User)).toBe(true);
    expect(matchWhere(u, CAMPAIGNS_BY_KEY.get('trial_ended')!.segment(fin) as User)).toBe(true);
    expect(fin.getTime() - j11.getTime()).toBeGreaterThanOrEqual(4 * 86_400_000);
  });

  it('jours de calendrier (Paris) jusqu’à la fin', () => {
    expect(parisDaysUntil(new Date('2026-11-16T08:00:00Z'), new Date('2026-11-13T09:00:00Z'))).toBe(3);
    expect(parisDaysUntil(new Date('2026-11-16T22:00:00Z'), new Date('2026-11-16T09:00:00Z'))).toBe(0);
  });
});

describe('essai Premium en cours exclu des relances Premium (#769)', () => {
  const cases: [string, User][] = [
    ['first_week_recap', { createdAt: daysAgo(8), trades: [{}] }],
    ['founder_followup', { createdAt: daysAgo(11) }],
    ['premium_upsell', { trades: [{ tradedAt: daysAgo(2) }] }],
  ];
  it.each(cases)('%s : essai en cours → rien ; essai terminé ou absent → envoyé', (key, base) => {
    expect(matches(key, user(base))).toBe(true);
    expect(matches(key, user({ ...base, trialEndsAt: new Date(NOW.getTime() + DAY) }))).toBe(false);
    expect(matches(key, user({ ...base, trialEndsAt: daysAgo(1) }))).toBe(true);
    expect(matches(key, user({ ...base, trialEndsAt: NOW }))).toBe(true); // fin pile maintenant
  });
});

describe('données chargées au moment de l’envoi', () => {
  const deps = (over: Partial<CampaignLoadDeps> & { rows?: unknown[] } = {}) =>
    ({
      prisma: {
        propFirm: { count: vi.fn().mockResolvedValue(16) },
        $queryRaw: vi.fn().mockResolvedValue(over.rows ?? []),
      },
      founderState: over.founderState ?? vi.fn().mockResolvedValue({ open: true, seatsLeft: 154, seatsTotal: 200 }),
    }) as unknown as CampaignLoadDeps;

  it('founder_followup : offre fermée ou complète → personne, vérifié à l’envoi', async () => {
    const load = CAMPAIGNS_BY_KEY.get('founder_followup')!.loadContext!;
    expect((await load(deps(), ['a', 'b'], NOW)).get('a')).toEqual({ seatsLeft: 154, seatsTotal: 200 });
    const closed = deps({ founderState: vi.fn().mockResolvedValue({ open: false, seatsLeft: 154, seatsTotal: 200 }) });
    expect((await load(closed, ['a'], NOW)).size).toBe(0);
    const full = deps({ founderState: vi.fn().mockResolvedValue({ open: true, seatsLeft: 0, seatsTotal: 200 }) });
    expect((await load(full, ['a'], NOW)).size).toBe(0);
  });

  it('prop_firm_rules : nombre de firmes du catalogue, une requête pour la page', async () => {
    const d = deps();
    const map = await CAMPAIGNS_BY_KEY.get('prop_firm_rules')!.loadContext!(d, ['a', 'b'], NOW);
    expect(map.get('b')).toEqual({ propFirmCount: 16 });
    expect(d.prisma.propFirm.count).toHaveBeenCalledTimes(1);
  });

  it('first_week_recap : une requête pour la page, P&L formaté, devises mélangées sans symbole', async () => {
    const d = deps({
      rows: [
        { userId: 'a', trades: 12, days: 4, net: 340, currencies: ['USD'] },
        { userId: 'b', trades: 3, days: 2, net: -92.5, currencies: ['USD', 'EUR'] },
      ],
    });
    const map = await loadFirstWeek(d, ['a', 'b', 'c']);
    expect(d.prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(map.get('a')).toEqual({ firstWeek: { trades: 12, days: 4, pnl: '+$340.00' } });
    expect(map.get('b')).toEqual({ firstWeek: { trades: 3, days: 2, pnl: '-92.50' } });
    expect(map.has('c')).toBe(false); // aucun trade sur J0-J7 → pas d'e-mail
  });

  it('first_week_recap : page vide → aucune requête', async () => {
    const d = deps();
    expect((await loadFirstWeek(d, [])).size).toBe(0);
    expect(d.prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
