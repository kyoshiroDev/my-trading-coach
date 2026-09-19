/**
 * PROMPT-192 — le compte démo doit rester peuplé ET récent.
 *
 * Constat prod (2026-08-28) : la démo affichait « P&L +0$ · Win Rate 0% · 0 trade loggé »
 * avec une session active depuis 1978 h. Le seed avait tourné une seule fois, le
 * 2026-06-07 ; ses dates étant relatives au run, tout était vieux de 82 jours.
 *
 * Le correctif rend le seed récurrent (DemoSeedCron). Ce qui doit donc être verrouillé :
 *  1. un re-seed REMPLACE les données démo (purge avant recréation) — il n'empile pas ;
 *  2. la purge reste scopée au user démo (aucun deleteMany sans userId) ;
 *  3. tous les trades générés tiennent dans la fenêtre « 1M » par défaut du dashboard.
 */
import { describe, it, expect, vi } from 'vitest';

// Chaque test lance le seed complet (hash du mot de passe + recherche du tirage) : sous la
// charge de la suite complète, deux runs dépassent les 5 s par défaut.
vi.setConfig({ testTimeout: 20_000 });
import { PrismaClient } from '@prisma/client';
import { seedDemo, assertDemoCalendar, DEMO_EMAIL, DEMO_WINDOW_DAYS } from './demo-seed';

/** Un jour ouvré (mercredi) à l'heure donnée, pour les tests de la démo « live ». */
function weekdayAt(hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + ((3 - d.getDay() + 7) % 7)); // prochain mercredi (ou aujourd'hui)
  d.setHours(hour, minute, 0, 0);
  return d;
}
/** Un samedi à l'heure donnée. */
function saturdayAt(hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  d.setHours(hour, 0, 0, 0);
  return d;
}

interface Call {
  model: string;
  op: string;
  args: Record<string, unknown>;
}

const DEMO_ID = 'demo-user-id';

/** Prisma double : enregistre les appels, renvoie le minimum exploité par seedDemo(). */
function fakePrisma(calls: Call[]) {
  const created: Record<string, Record<string, unknown>[]> = {};
  const model = (name: string) => ({
    upsert: vi.fn(async (args: Record<string, unknown>) => {
      calls.push({ model: name, op: 'upsert', args });
      return { id: DEMO_ID, email: DEMO_EMAIL };
    }),
    create: vi.fn(async (args: Record<string, unknown>) => {
      calls.push({ model: name, op: 'create', args });
      (created[name] ??= []).push(args['data'] as Record<string, unknown>);
      return { id: `${name}-${(created[name] ?? []).length}` };
    }),
    createMany: vi.fn(async (args: Record<string, unknown>) => {
      calls.push({ model: name, op: 'createMany', args });
      return { count: 0 };
    }),
    count: vi.fn(async (args: Record<string, unknown>) => {
      calls.push({ model: name, op: 'count', args });
      return 0;
    }),
    deleteMany: vi.fn(async (args: Record<string, unknown>) => {
      calls.push({ model: name, op: 'deleteMany', args });
      return { count: 0 };
    }),
    update: vi.fn(async (args: Record<string, unknown>) => {
      calls.push({ model: name, op: 'update', args });
      return {};
    }),
    findMany: vi.fn(async (args: Record<string, unknown>) => {
      calls.push({ model: name, op: 'findMany', args });
      // Les setups par défaut, tels que seedDefaultSetups vient de les poser.
      return name === 'setup'
        ? ['Breakout', 'Pullback', 'Range', 'Reversal', 'Scalping', 'News'].map((title) => ({
            id: `setup-${title}`,
            title,
          }))
        : [];
    }),
  });

  const prisma = {
    user: model('user'),
    trade: model('trade'),
    tradeSession: model('tradeSession'),
    weeklyDebrief: model('weeklyDebrief'),
    dailyRecap: model('dailyRecap'),
    setup: model('setup'),
    ecoEvent: model('ecoEvent'),
    tradingAccount: model('tradingAccount'),
    brokerConnection: model('brokerConnection'),
  };
  return { prisma: prisma as unknown as PrismaClient, created };
}

describe('seedDemo — re-seed idempotent (le cron quotidien ne doit pas empiler)', () => {
  it('purge les données démo AVANT d\'en recréer, pour chaque modèle seedé', async () => {
    const calls: Call[] = [];
    await seedDemo(fakePrisma(calls).prisma);

    for (const m of ['trade', 'tradeSession', 'tradingAccount', 'brokerConnection', 'weeklyDebrief', 'dailyRecap']) {
      const purge = calls.findIndex((c) => c.model === m && c.op === 'deleteMany');
      const firstCreate = calls.findIndex((c) => c.model === m && c.op === 'create');
      expect(purge, `${m} : aucune purge → un 2e run empilerait les données`).toBeGreaterThan(-1);
      expect(
        firstCreate === -1 || purge < firstCreate,
        `${m} : la purge doit précéder la recréation`,
      ).toBe(true);
    }
  });

  it('ne purge que le user démo (jamais les données des vrais comptes)', async () => {
    const calls: Call[] = [];
    await seedDemo(fakePrisma(calls).prisma);

    const purges = calls.filter((c) => c.op === 'deleteMany');
    expect(purges.length).toBeGreaterThan(0);
    for (const p of purges) {
      expect(
        (p.args['where'] as { userId?: string } | undefined)?.userId,
        `deleteMany sur ${p.model} non scopé au user démo`,
      ).toBe(DEMO_ID);
    }
  });

  it('deux runs successifs produisent le même volume (remplacement, pas accumulation)', async () => {
    const first = fakePrisma([]);
    const a = await seedDemo(first.prisma);
    const second = fakePrisma([]);
    const b = await seedDemo(second.prisma);

    expect(b).toEqual(a);
    expect(second.created['trade']?.length).toBe(first.created['trade']?.length);
    expect(second.created['tradeSession']?.length).toBe(first.created['tradeSession']?.length);
    expect(
      second.created['tradingAccount']?.length,
      'Les comptes s\'empilent : 2 runs doivent laisser 2 comptes, pas 4',
    ).toBe(first.created['tradingAccount']?.length);
  });

  it('purge les comptes APRÈS les trades et les sessions (onDelete SetNull)', () => {
    // TradingAccount est reférencé par Trade.accountId / TradeSession.accountId en
    // onDelete: SetNull. Purger les comptes d'abord détacherait les lignes au lieu de
    // les supprimer : elles survivraient au re-seed, orphelines et invisibles.
    const calls: Call[] = [];
    return seedDemo(fakePrisma(calls).prisma).then(() => {
      const at = (m: string) => calls.findIndex((c) => c.model === m && c.op === 'deleteMany');
      expect(at('tradingAccount')).toBeGreaterThan(at('trade'));
      expect(at('tradingAccount')).toBeGreaterThan(at('tradeSession'));
    });
  });
});

describe('seedDemo — comptes de trading (cohérence dashboard / Mes comptes)', () => {
  it('crée 2 comptes prop firm actifs en USD : Apex (éval) et Tradeify (funded)', async () => {
    const { prisma, created } = fakePrisma([]);
    const res = await seedDemo(prisma);

    const accounts = created['tradingAccount'];
    expect(accounts).toHaveLength(2);
    expect(res.accounts).toBe(2);
    expect(accounts.every((a) => a['status'] === 'ACTIVE')).toBe(true);
    expect(accounts.every((a) => a['currency'] === 'USD')).toBe(true);
    expect(accounts.map((a) => a['type']).sort()).toEqual(['EVALUATION', 'FUNDED']);
    expect(accounts.map((a) => a['broker']).sort()).toEqual(['Apex', 'Tradeify']);
  });

  it('Σ startingBalance des comptes === capital du profil (sinon les 2 pages divergent)', async () => {
    const calls: Call[] = [];
    const { prisma, created } = fakePrisma(calls);
    await seedDemo(prisma);

    // dashboard.baseCapital somme les startingBalance dès qu'un compte existe, et ne
    // retombe sur user.startingCapital que s'il n'y en a aucun ; accounts.trackedCapital
    // fait la même somme. Les deux doivent coller, sinon les pages se contredisent.
    const upsert = calls.find((c) => c.model === 'user' && c.op === 'upsert');
    const profileCapital = (upsert?.args['create'] as { startingCapital: number })
      .startingCapital;
    const sumBalances = created['tradingAccount'].reduce(
      (s, a) => s + (a['startingBalance'] as number),
      0,
    );

    expect(
      sumBalances,
      `Σ startingBalance = ${sumBalances} mais capital profil = ${profileCapital}`,
    ).toBe(profileCapital);
  });

  it('AUCUN trade ne reste flottant : tous rattachés à un compte', async () => {
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma);

    const ids = new Set(created['tradingAccount'].map((_, i) => `tradingAccount-${i + 1}`));
    const orphans = created['trade'].filter((t) => !t['accountId']);
    expect(
      orphans.length,
      `${orphans.length} trades sans accountId → « Mes comptes » et le sélecteur agrégé afficheraient 0`,
    ).toBe(0);
    expect(created['trade'].every((t) => ids.has(t['accountId'] as string))).toBe(true);
  });

  it('les sessions aussi sont rattachées (pas de session flottante)', async () => {
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma);

    expect(created['tradeSession'].every((s) => !!s['accountId'])).toBe(true);
  });

  it("futures d'indices US uniquement (MES, MNQ, ES, NQ) : ni forex, ni crypto, ni or", async () => {
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma);

    const assets = new Set(created['trade'].map((t) => t['asset'] as string));
    expect([...assets].every((a) => ['MES', 'MNQ', 'ES', 'NQ'].includes(a))).toBe(true);
    expect(assets.has('MNQ') && assets.has('MES')).toBe(true);
  });

  it('le compte prop firm porte les vraies règles Apex 50k', async () => {
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma);

    const apex = created['tradingAccount'].find((a) => a['type'] === 'EVALUATION')!;
    // Apex 50k Full Evaluation : base 50 000, objectif +3 000, trailing drawdown 2 500.
    // Le palier doit exister réellement — le 20k générique d'avant n'était proposé par
    // aucune firme, ce qu'un prospect qui connaît Apex repérait.
    expect(apex['startingBalance']).toBe(50_000);
    expect(apex['accountSize']).toBe(50_000);
    expect(apex['profitTarget']).toBe(3_000);
    expect(apex['maxDrawdown']).toBe(2_500);
    expect(apex['drawdownType']).toBe('TRAILING');
  });

  it('l\'évaluation est EN COURS : P&L sous l\'objectif, drawdown loin du seuil', async () => {
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma);

    const accounts = created['tradingAccount'];
    const idx = accounts.findIndex((a) => a['type'] === 'EVALUATION');
    const apex = accounts[idx];
    const trades = created['trade'].filter(
      (t) => t['accountId'] === `tradingAccount-${idx + 1}`,
    );
    const net = (t: Record<string, unknown>) => (t['pnl'] as number) - (t['commission'] as number);
    const pnl = trades.reduce((s, t) => s + net(t), 0);
    const target = apex['profitTarget'] as number;

    // Une éval déjà passée (P&L ≥ objectif) enlèverait tout intérêt à la carte « pacing »,
    // et un P&L qui frôle l'objectif se lirait comme une promesse de réussite.
    expect(pnl).toBeGreaterThan(0);
    expect(pnl, `P&L ${pnl} ≥ objectif ${target} : l'éval serait déjà passée`).toBeLessThan(
      target,
    );
    expect(pnl / target).toBeLessThan(0.8);

    // Marge de drawdown confortable : on montre une éval saine, pas au bord de la
    // liquidation. Trailing → plancher qui suit le plus haut solde atteint.
    const sorted = [...trades].sort(
      (a, b) => (a['tradedAt'] as Date).getTime() - (b['tradedAt'] as Date).getTime(),
    );
    let bal = apex['startingBalance'] as number;
    let hwm = bal;
    let worstGap = 0;
    for (const t of sorted) {
      bal += net(t);
      if (bal > hwm) hwm = bal;
      worstGap = Math.max(worstGap, hwm - bal);
    }
    const maxDd = apex['maxDrawdown'] as number;
    expect(
      worstGap,
      `Drawdown max ${worstGap} sur ${maxDd} autorisés : la démo frôle la liquidation`,
    ).toBeLessThan(maxDd * 0.5);
  });

  it('les deux comptes portent des trades (aucun compte vide à 0)', async () => {
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma);

    for (let i = 1; i <= created['tradingAccount'].length; i++) {
      const n = created['trade'].filter((t) => t['accountId'] === `tradingAccount-${i}`).length;
      expect(n, `Le compte ${i} n'a aucun trade : il afficherait 0 partout`).toBeGreaterThan(0);
    }
  });
});

describe('seedDemo — fraîcheur des données (visible sans changer de filtre)', () => {
  it('tous les trades tiennent dans la fenêtre de 6 semaines, et la vue « 1M » reste pleine', async () => {
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma);

    const now = Date.now();
    const ages = created['trade'].map((t) => (now - (t['tradedAt'] as Date).getTime()) / 86_400_000);
    const oldest = Math.max(...ages);
    expect(oldest, `Trade le plus ancien : ${oldest.toFixed(1)} j`).toBeLessThanOrEqual(DEMO_WINDOW_DAYS);
    // La fenêtre « 1M » par défaut du dashboard doit être bien remplie, pas seulement la fin.
    expect(ages.filter((a) => a <= 30).length).toBeGreaterThanOrEqual(45);
  });

  it('un jour ouvré : la journée en cours et la veille sont peuplées (session live + carte « Hier »)', async () => {
    const now = weekdayAt(15);
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma, now);

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);

    const at = (t: Record<string, unknown>) => (t['tradedAt'] as Date).getTime();
    const today = created['trade'].filter((t) => at(t) >= startOfToday.getTime());
    const yesterday = created['trade'].filter(
      (t) => at(t) >= startOfYesterday.getTime() && at(t) < startOfToday.getTime(),
    );

    expect(today.length, 'Session live démo vide → « Aucun trade loggé »').toBeGreaterThan(0);
    expect(yesterday.length, 'Carte « Hier » de la pré-session vide').toBeGreaterThan(0);
  });

  it('un jour ouvré : la session du jour est ACTIVE et démarrée aujourd\'hui (pas un compteur à 1978 h)', async () => {
    const now = weekdayAt(15);
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma, now);

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const active = created['tradeSession'].filter((s) => s['status'] === 'ACTIVE');

    expect(active.length, 'Aucune session active : la démo ne montre pas le mode live').toBe(1);
    expect((active[0]['startedAt'] as Date).getTime()).toBeGreaterThanOrEqual(
      startOfToday.getTime(),
    );
  });
});

describe('seedDemo — sobriété AMF (montrer la fonctionnalité, pas une performance)', () => {
  it('le P&L total reste modeste au regard du capital de départ', async () => {
    const calls: Call[] = [];
    const { prisma, created } = fakePrisma(calls);
    await seedDemo(prisma);

    // P&L NET (frais déduits), comme partout dans l'app (PROMPT-213).
    const pnl = created['trade'].reduce(
      (s, t) => s + (t['pnl'] as number) - (t['commission'] as number),
      0,
    );
    // Lu depuis le seed, jamais en dur : le capital a déjà bougé (25 000 → 55 000 avec
    // le passage au palier Apex 50k réel) et un nombre figé aurait faussé le ratio.
    const upsert = calls.find((c) => c.model === 'user' && c.op === 'upsert');
    const startingCapital = (upsert?.args['create'] as { startingCapital: number })
      .startingCapital;
    const pct = (pnl / startingCapital) * 100;

    expect(pnl, 'Le P&L démo doit rester positif (produit crédible)').toBeGreaterThan(0);
    expect(
      pct,
      `+${pct.toFixed(1)} % sur la fenêtre démo : ça se lit comme une promesse de gain`,
    ).toBeLessThan(15);
  });

  it('des pertes restent visibles (jamais une démo 100 % gagnante)', async () => {
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma);

    const losses = created['trade'].filter((t) => (t['pnl'] as number) < 0);
    const wins = created['trade'].filter((t) => (t['pnl'] as number) > 0);
    const winRate = (wins.length / (wins.length + losses.length)) * 100;

    expect(losses.length, 'Aucune perte affichée : démo malhonnête').toBeGreaterThan(0);
    expect(winRate).toBeGreaterThan(45);
    expect(winRate, 'Win rate trop beau pour être vrai').toBeLessThan(70);
  });
});

describe('seedDemo — connexion Tradovate démo (PROMPT-207)', () => {
  it('le compte prop firm apparaît connecté, sans aucun vrai token, et une seule connexion par run', async () => {
    const calls: Call[] = [];
    const { prisma, created } = fakePrisma(calls);
    await seedDemo(prisma);

    const connections = created['brokerConnection'] ?? [];
    expect(connections).toHaveLength(1);
    const [conn] = connections;
    // Rattachée au compte futures (1er compte créé), jamais au user seul.
    expect(conn['accountId']).toBe('tradingAccount-1');
    expect(conn).toMatchObject({ provider: 'TRADOVATE', status: 'CONNECTED' });
    expect(conn['lastSyncAt']).toBeInstanceOf(Date);
    // Placeholder non déchiffrable : le compte démo ne synchronise jamais (DemoReadOnlyGuard).
    expect(String(conn['accessTokenEnc']).startsWith('v1:')).toBe(false);
    expect(conn['refreshTokenEnc']).toBeUndefined();
  });
});

describe('seedDemo — réalisme validé (PROMPT-215) : un trader crédible, pas un gagnant parfait', () => {
  const net = (t: Record<string, unknown>) => (t['pnl'] as number) - (t['commission'] as number);
  const dayKey = (t: Record<string, unknown>) => (t['tradedAt'] as Date).toDateString();

  it('des frais réels sur chaque trade : le net est visiblement sous le brut', async () => {
    const { prisma, created } = fakePrisma([]);
    const res = await seedDemo(prisma);

    expect(created['trade'].every((t) => (t['commission'] as number) > 0)).toBe(true);
    expect(res.fees).toBeGreaterThan(400);
    expect(res.grossPnl - res.pnl).toBeCloseTo(res.fees, 1);
    expect(res.pnl).toBeLessThan(res.grossPnl);
  });

  it('win rate NET crédible (52-57 %) et ~40 % de journées rouges', async () => {
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma);

    const wins = created['trade'].filter((t) => net(t) > 0).length;
    const losses = created['trade'].filter((t) => net(t) < 0).length;
    const wr = (wins / (wins + losses)) * 100;
    expect(wr).toBeGreaterThanOrEqual(52);
    expect(wr).toBeLessThanOrEqual(57);

    const byDay = new Map<string, number>();
    for (const t of created['trade']) byDay.set(dayKey(t), (byDay.get(dayKey(t)) ?? 0) + net(t));
    const red = [...byDay.values()].filter((v) => v < 0).length / byDay.size;
    expect(red).toBeGreaterThanOrEqual(0.35);
    expect(red).toBeLessThanOrEqual(0.45);
  });

  it('jours ouvrés UNIQUEMENT : zéro trade samedi / dimanche, quel que soit le jour du run', async () => {
    for (let i = 0; i < 7; i++) {
      const now = weekdayAt(3, 20);
      now.setDate(now.getDate() + i); // mercredi … mardi, week-end compris
      const { prisma, created } = fakePrisma([]);
      await seedDemo(prisma, now);
      const weekend = created['trade'].filter((t) => [0, 6].includes((t['tradedAt'] as Date).getDay()));
      expect(weekend, `run du ${now.toDateString()}`).toHaveLength(0);
    }
  });

  it('le week-end : pas de session live ni de trade du jour, le dernier jour tradé est vendredi', async () => {
    const now = saturdayAt(11);
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma, now);

    expect(created['tradeSession'].filter((x) => x['status'] === 'ACTIVE')).toHaveLength(0);
    const last = Math.max(...created['trade'].map((t) => (t['tradedAt'] as Date).getTime()));
    expect(new Date(last).getDay()).toBe(5);
  });

  it('garde-fou : un trade un week-end ou hors futures fait échouer le seed', () => {
    const saturday = saturdayAt(10);
    const monday = weekdayAt(10);
    expect(() => assertDemoCalendar([{ trades: [{ tradedAt: saturday, asset: 'MNQ' }] }])).toThrow(/week-end/);
    expect(() => assertDemoCalendar([{ trades: [{ tradedAt: monday, asset: 'BTC/USDT' }] }])).toThrow(/hors futures/);
    expect(() => assertDemoCalendar([{ trades: [{ tradedAt: monday, asset: 'MES' }] }])).not.toThrow();
  });

  it('setups contrastés : Breakout meilleur, Reversal perdant, Scalping positif en brut mais négatif en net', async () => {
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma);

    const of = (title: string) => created['trade'].filter((t) => t['setupId'] === `setup-${title}`);
    const wr = (ts: Record<string, unknown>[]) => ts.filter((t) => net(t) > 0).length / ts.length;
    const titles = ['Breakout', 'Pullback', 'Range', 'Reversal', 'News', 'Scalping'];
    const rates = Object.fromEntries(titles.map((x) => [x, wr(of(x))]));
    expect(rates['Breakout']).toBeGreaterThanOrEqual(Math.max(rates['Pullback'], rates['Range'], rates['Reversal'], rates['News']));
    expect(rates['Reversal']).toBeLessThanOrEqual(Math.min(rates['Breakout'], rates['Pullback'], rates['Range'], rates['News']));
    expect(of('Reversal').reduce((a, t) => a + net(t), 0)).toBeLessThan(0);

    const scalp = of('Scalping');
    expect(scalp.reduce((a, t) => a + (t['pnl'] as number), 0), 'Scalping brut').toBeGreaterThan(0);
    expect(scalp.reduce((a, t) => a + net(t), 0), 'Scalping net : les frais doivent le rendre négatif').toBeLessThan(0);
  });

  it('une séquence de revenge trading : ré-entrées REVENGE < 2 min après une perte, taille doublée', async () => {
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma);

    const revenge = created['trade'].filter((t) => t['emotion'] === 'REVENGE');
    expect(revenge.length).toBeGreaterThanOrEqual(2);
    const sorted = [...created['trade']].sort((a, b) => (a['tradedAt'] as Date).getTime() - (b['tradedAt'] as Date).getTime());
    const first = sorted.indexOf(revenge[0]);
    const prev = sorted[first - 1];
    expect(net(prev)).toBeLessThan(0);
    expect(((revenge[0]['tradedAt'] as Date).getTime() - (prev['tradedAt'] as Date).getTime()) / 60_000).toBeLessThan(2);
    expect(revenge[0]['quantity'] as number).toBeGreaterThanOrEqual(2 * (prev['quantity'] as number));
    expect(revenge[0]['stopLoss']).toBeNull();
  });

  it('note d’exécution renseignée et contrastée (les deux barèmes, du EXCELLENT au MAUVAIS)', async () => {
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma);

    const grades = new Set(created['trade'].map((t) => t['executionGrade']));
    expect(grades.has('EXCELLENT') && grades.has('MAUVAIS')).toBe(true);
    const methods = new Set(created['trade'].map((t) => t['executionMethod']));
    expect(methods.has('STOP_BASED') && methods.has('BEHAVIORAL')).toBe(true);
  });

  it('débriefs hebdo par compte et un récap par jour de trading', async () => {
    const { prisma, created } = fakePrisma([]);
    const res = await seedDemo(prisma, weekdayAt(15));

    expect(res.debriefs).toBeGreaterThanOrEqual(5);
    const d = created['weeklyDebrief'][0];
    const insights = d['insights'] as { accounts: { stats: { totalTrades: number } }[]; summary: string };
    expect(insights.accounts).toHaveLength(2);
    expect(insights.summary).toMatch(/frais/);
    expect(created['dailyRecap'].length).toBe(res.tradingDays - 1); // tous sauf aujourd'hui
  });
});

describe('seedDemo — dates relatives au run (cron quotidien de 03:20)', () => {
  it('à 03:20 : aucun trade dans le futur, session du jour démarrée aujourd’hui, récap daté d’hier', async () => {
    const now = weekdayAt(3, 20);
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma, now);

    expect(created['trade'].filter((t) => (t['tradedAt'] as Date) > now)).toHaveLength(0);

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const active = created['tradeSession'].filter((x) => x['status'] === 'ACTIVE');
    expect(active).toHaveLength(1);
    expect((active[0]['startedAt'] as Date).getTime()).toBeGreaterThanOrEqual(startOfToday.getTime());
    expect((active[0]['startedAt'] as Date).getTime()).toBeLessThanOrEqual(now.getTime());

    const yesterday = new Date(startOfToday);
    yesterday.setDate(yesterday.getDate() - 1);
    const recapDates = created['dailyRecap'].map((r) => (r['date'] as Date).getTime());
    expect(recapDates).toContain(yesterday.getTime());
    expect(Math.max(...recapDates)).toBe(yesterday.getTime());
  });
});
