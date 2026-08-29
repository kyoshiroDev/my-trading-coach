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
import { PrismaClient } from '@prisma/client';
import { seedDemo, DEMO_EMAIL, DEMO_WINDOW_DAYS } from './demo-seed';

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
  };
  return { prisma: prisma as unknown as PrismaClient, created };
}

describe('seedDemo — re-seed idempotent (le cron quotidien ne doit pas empiler)', () => {
  it('purge les données démo AVANT d\'en recréer, pour chaque modèle seedé', async () => {
    const calls: Call[] = [];
    await seedDemo(fakePrisma(calls).prisma);

    for (const m of ['trade', 'tradeSession', 'tradingAccount', 'weeklyDebrief', 'dailyRecap']) {
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
  it('crée 2 comptes actifs : une prop firm et un compte perso', async () => {
    const { prisma, created } = fakePrisma([]);
    const res = await seedDemo(prisma);

    const accounts = created['tradingAccount'];
    expect(accounts).toHaveLength(2);
    expect(res.accounts).toBe(2);
    expect(accounts.every((a) => a['status'] === 'ACTIVE')).toBe(true);
    expect(accounts.map((a) => a['type']).sort()).toEqual(['EVALUATION', 'PERSONAL']);
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

  it('route forex + crypto vers le perso, futures purs vers la prop firm', async () => {
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma);

    const idOf = (label: string) =>
      `tradingAccount-${created['tradingAccount'].findIndex((a) => a['label'] === label) + 1}`;
    const perso = idOf('Compte perso · Forex & Crypto');
    const futures = idOf('Apex 50k · Éval');

    // La prop firm ne porte QUE des futures : pas d'EUR/USD spot ni de BTC sur une éval.
    const personal = ['BTC/USDT', 'EUR/USD'];
    const onPerso = created['trade'].filter((t) => personal.includes(t['asset'] as string));
    expect(onPerso.length).toBeGreaterThan(0);
    expect(onPerso.every((t) => t['accountId'] === perso)).toBe(true);

    const onFutures = created['trade'].filter((t) => !personal.includes(t['asset'] as string));
    expect(onFutures.every((t) => t['accountId'] === futures)).toBe(true);
    expect(onFutures.every((t) => ['MNQ', 'MES', 'GC'].includes(t['asset'] as string))).toBe(true);
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
    const pnl = trades.reduce((s, t) => s + (t['pnl'] as number), 0);
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
      bal += t['pnl'] as number;
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
  it('tous les trades tiennent dans les 30 derniers jours', async () => {
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma);

    const now = Date.now();
    const oldest = created['trade'].reduce(
      (min, t) => Math.min(min, (t['tradedAt'] as Date).getTime()),
      now,
    );
    const ageDays = (now - oldest) / 86_400_000;
    expect(
      ageDays,
      `Le trade le plus ancien a ${ageDays.toFixed(1)} j : hors de la fenêtre 1M par défaut`,
    ).toBeLessThanOrEqual(DEMO_WINDOW_DAYS);
  });

  it('la journée en cours et la veille sont peuplées (session live + carte « Hier »)', async () => {
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma);

    const startOfToday = new Date();
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

  it('la session du jour est ACTIVE et démarrée aujourd\'hui (pas un compteur à 1978 h)', async () => {
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma);

    const startOfToday = new Date();
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

    const pnl = created['trade'].reduce((s, t) => s + (t['pnl'] as number), 0);
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
