/**
 * le compte démo doit rester peuplé ET récent.
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
//
// 60 s et pas 20 : le test des jours ouvrés enchaîne SEPT seeds dans une seule assertion, et il
// a été mesuré à 20,1 s — donc en échec — pendant un run de la suite entière sur une machine
// chargée, alors qu'il tient en 30 s pour le fichier complet au repos. Un runner CI partagé est
// plus lent qu'un poste de dev : à 20 s la marge était nulle, et l'échec ressemblait à une
// régression de code alors que c'était l'horloge. Même valeur que `vitest.integration.config.mts`.
vi.setConfig({ testTimeout: 60_000 });
import { PrismaClient } from '@prisma/client';
import { seedDemo, assertDemoCalendar, buildDemoDataset, DEMO_EMAIL, DEMO_WINDOW_DAYS } from './demo-seed';
import { generate } from './demo-data/generate';

/** Un jour ouvré (mercredi) à l'heure donnée, pour les tests de la démo « live ». */
function weekdayAt(hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + ((3 - d.getDay() + 7) % 7)); // prochain mercredi (ou aujourd'hui)
  d.setHours(hour, minute, 0, 0);
  return d;
}
/** Un lundi à l'heure donnée (la veille ouvrée est le vendredi de la semaine précédente). */
function mondayAt(hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + ((1 - d.getDay() + 7) % 7));
  d.setHours(hour, 0, 0, 0);
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
    brokerDailyClose: model('brokerDailyClose'),
    accountRiskDay: model('accountRiskDay'),
    propRiskEvent: model('propRiskEvent'),
    // Catalogue synchronisé : les deux plans des comptes démo existent.
    propFirmPlan: { findMany: vi.fn(async () => [{ id: 'apex-eod-50k' }, { id: 'tradeify-select-flex-50k' }]) },
  };
  return { prisma: prisma as unknown as PrismaClient, created };
}

/** Trades des comptes ACTIFS (jeu de données principal), sans ceux des comptes perdus. */
function activeTrades(created: Record<string, Record<string, unknown>[]>) {
  const ids = new Set(
    created['tradingAccount']
      .map((a, i) => (a['status'] === 'ACTIVE' ? `tradingAccount-${i + 1}` : null))
      .filter((x): x is string => x !== null),
  );
  return created['trade'].filter((t) => ids.has(t['accountId'] as string));
}

describe('seedDemo — compte perdu (statistiques exclues dans la démo)', () => {
  it('un compte échoué, sa nouvelle tentative active et un archivé ; aucun compte validé', async () => {
    const { prisma, created } = fakePrisma([]);
    const res = await seedDemo(prisma);
    const byLabel = new Map(created['tradingAccount'].map((a) => [a['label'] as string, a]));
    expect(byLabel.get('Apex 50k · Éval #1')).toMatchObject({ status: 'FAILED', broker: 'Apex Trader Funding', accountSize: 50_000 });
    expect(byLabel.get('Apex 50k · Éval #2')).toMatchObject({ status: 'ACTIVE', broker: 'Apex Trader Funding', accountSize: 50_000 });
    expect(byLabel.get('Lucid 25k · Flex')).toMatchObject({ status: 'ARCHIVED' });
    // Un compte validé serait compté dans les chiffres et changerait ceux de la vitrine.
    expect(created['tradingAccount'].some((a) => a['status'] === 'PASSED')).toBe(false);
    expect(res.lostAccounts).toBe(2);
  });

  it('chaque compte perdu a des trades, tous antérieurs à la fenêtre, en jour ouvré', async () => {
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma);
    const lostIds = created['tradingAccount']
      .map((a, i) => (a['status'] !== 'ACTIVE' ? `tradingAccount-${i + 1}` : null))
      .filter((x): x is string => x !== null);
    expect(lostIds).toHaveLength(2);
    const now = Date.now();
    for (const id of lostIds) {
      const trades = created['trade'].filter((t) => t['accountId'] === id);
      expect(trades.length, id).toBeGreaterThan(0);
      for (const t of trades) {
        const at = t['tradedAt'] as Date;
        expect((now - at.getTime()) / 86_400_000).toBeGreaterThan(DEMO_WINDOW_DAYS);
        expect([0, 6]).not.toContain(at.getUTCDay());
      }
    }
  });

  it('l\'échoué a dépassé son plancher (en net, frais déduits)', async () => {
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma);
    const netTrade = (t: Record<string, unknown>) => (t['pnl'] as number) - (t['commission'] as number);
    const netOf = (label: string) => {
      const i = created['tradingAccount'].findIndex((a) => a['label'] === label);
      return created['trade']
        .filter((t) => t['accountId'] === `tradingAccount-${i + 1}`)
        .reduce((s, t) => s + netTrade(t), 0);
    };
    expect(netOf('Apex 50k · Éval #1')).toBeLessThan(-2_000);
  });

  it('aucune connexion broker sur les comptes perdus (vitrine limitée aux comptes actifs)', async () => {
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma);
    expect(created['brokerConnection']).toHaveLength(3);
  });
});

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
  it('crée 3 comptes prop firm actifs en USD : Apex (éval), Tradeify (funded), Elite statique 25K (éval)', async () => {
    const { prisma, created } = fakePrisma([]);
    const res = await seedDemo(prisma);

    // Les comptes perdus (échoué, validé, archivé) sont testés à part, plus bas.
    const accounts = created['tradingAccount'].filter((a) => a['status'] === 'ACTIVE');
    expect(accounts).toHaveLength(3);
    expect(res.accounts).toBe(3);
    expect(accounts.every((a) => a['currency'] === 'USD')).toBe(true);
    expect(accounts.map((a) => a['type']).sort()).toEqual(['EVALUATION', 'EVALUATION', 'FUNDED']);
    expect(accounts.map((a) => a['broker']).sort()).toEqual(['Apex Trader Funding', 'Elite Trader Funding', 'Tradeify']);
    // Plan statique d'une autre firme et d'une autre taille : la carte drawdown change de comportement.
    expect(accounts.find((a) => a['broker'] === 'Elite Trader Funding')).toMatchObject({
      accountSize: 25_000, startingBalance: 25_000, maxDrawdown: 1_000, drawdownType: 'STATIC',
    });
  });

  it('compte statique : tirage séparé, les comptes Apex et Tradeify sont inchangés', () => {
    const now = new Date('2026-10-20T15:00:00');
    const { days } = buildDemoDataset(now);
    const elite = days.filter((d) => d.account === 'elite');
    expect(elite.length).toBeGreaterThanOrEqual(5);
    expect(elite.every((d) => d.kind === 'secondary')).toBe(true);
    expect(elite.every((d) => d.daysAgo <= 27)).toBe(true); // visible dans la vue « 1 mois »
    // Passe sous son solde de départ (25 à 70 % du drawdown, en clôture), finit au-dessus.
    let cum = 0, low = 0;
    for (const d of [...elite].sort((x, y) => y.daysAgo - x.daysAgo)) {
      cum += d.trades.reduce((a, t) => a + t.pnl - t.commission, 0);
      low = Math.min(low, cum);
    }
    expect(-low).toBeGreaterThanOrEqual(250);
    expect(-low).toBeLessThan(700);
    expect(cum).toBeGreaterThan(0);
    // Jamais un jour sans journée d'un compte principal (le récap du jour reste unique).
    const mainDates = new Set(days.filter((d) => d.account !== 'elite').map((d) => d.daysAgo));
    expect(elite.every((d) => mainDates.has(d.daysAgo))).toBe(true);
    // Le tirage principal ne dépend pas du compte statique.
    const main = days.filter((d) => d.account !== 'elite');
    const seedOnly = generate(now, buildDemoDataset(now).seed);
    expect(main.flatMap((d) => d.trades.map((t) => t.pnl))).toEqual(seedOnly.flatMap((d) => d.trades.map((t) => t.pnl)));
  });

  it.each(['2026-10-05T03:20:00', '2026-10-14T11:00:00', '2026-11-03T17:30:00', '2026-12-11T03:20:00', '2027-01-19T16:00:00'])(
    'compte statique lisible quel que soit le jour du seed (%s)', (iso) => {
      const { days } = buildDemoDataset(new Date(iso));
      const elite = days.filter((d) => d.account === 'elite' && d.trades.length).sort((x, y) => y.daysAgo - x.daysAgo);
      let cum = 0, low = 0;
      for (const d of elite) { cum += d.trades.reduce((a, t) => a + t.pnl - t.commission, 0); low = Math.min(low, cum); }
      expect(-low).toBeGreaterThanOrEqual(250);
      expect(cum).toBeGreaterThan(0);
    },
  );

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
    // Contrat de `config.ts` : comptes ACTIFS seulement. Le compte validé de la démo est compté de
    // la même façon par les deux pages (règle `countsInAggregate` du front), il ne les fait pas diverger.
    const sumBalances = created['tradingAccount']
      .filter((a) => a['status'] === 'ACTIVE')
      .reduce((s, a) => s + (a['startingBalance'] as number), 0);

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

  it('le compte prop firm porte les vraies règles Apex 50k et est relié au plan du catalogue', async () => {
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma);

    const apex = created['tradingAccount'].find((a) => a['type'] === 'EVALUATION')!;
    // Apex EOD Trail 50K (catalogue) : base 50 000, objectif +3 000, trailing EOD 2 000.
    // Le palier doit exister réellement — le 20k générique d'avant n'était proposé par
    // aucune firme, ce qu'un prospect qui connaît Apex repérait.
    expect(apex['startingBalance']).toBe(50_000);
    expect(apex['accountSize']).toBe(50_000);
    expect(apex['profitTarget']).toBe(3_000);
    expect(apex['maxDrawdown']).toBe(2_000);
    expect(apex['drawdownType']).toBe('TRAILING');
    expect(apex['propFirmPlanId']).toBe('apex-eod-50k');
    const funded = created['tradingAccount'].find((a) => a['type'] === 'FUNDED')!;
    expect(funded['propFirmPlanId']).toBe('tradeify-select-flex-50k');
  });

  it('catalogue pas encore synchronisé : comptes créés sans plan relié', async () => {
    const { prisma, created } = fakePrisma([]);
    (prisma as unknown as { propFirmPlan: { findMany: () => Promise<unknown[]> } }).propFirmPlan.findMany = async () => [];
    await seedDemo(prisma);
    expect(created['tradingAccount'].every((a) => a['propFirmPlanId'] === null)).toBe(true);
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
    // Trades des comptes actifs : ceux des comptes perdus sont volontairement antérieurs à la fenêtre.
    const ages = activeTrades(created).map((t) => (now - (t['tradedAt'] as Date).getTime()) / 86_400_000);
    const oldest = Math.max(...ages);
    // Fenêtre CALENDAIRE : le jour le plus ancien est J-42, posé à une heure de séance. Son âge
    // en heures dépasse donc 42 j dès que le test tourne plus tard dans la journée que la séance
    // — ce qui rendait l'assertion rouge selon l'heure d'exécution, pas selon le seed.
    expect(
      Math.floor(oldest),
      `Trade le plus ancien : ${oldest.toFixed(1)} j`,
    ).toBeLessThanOrEqual(DEMO_WINDOW_DAYS);
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

    // P&L NET (frais déduits), comme partout dans l'app, sur les comptes actifs : c'est le P&L
    // affiché (les comptes échoué et archivé de la démo sont hors des chiffres).
    const pnl = activeTrades(created).reduce(
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

describe('seedDemo — connexion Tradovate démo', () => {
  it('tous les comptes prop firm apparaissent connectés, sans aucun vrai token, une connexion par compte', async () => {
    const calls: Call[] = [];
    const { prisma, created } = fakePrisma(calls);
    await seedDemo(prisma);

    const connections = created['brokerConnection'] ?? [];
    // Tous : la session live montre le suivi prop firm quel que soit le compte de la séance.
    expect(connections).toHaveLength(3);
    expect(connections.map((c) => c['accountId'])).toEqual(['tradingAccount-1', 'tradingAccount-2', 'tradingAccount-3']);
    expect(new Set(connections.map((c) => c['externalAccountId'])).size).toBe(3);
    for (const conn of connections) {
      expect(conn).toMatchObject({ provider: 'TRADOVATE', status: 'CONNECTED' });
      expect(conn['lastSyncAt']).toBeInstanceOf(Date);
      // Placeholder non déchiffrable : le compte démo ne synchronise jamais (DemoReadOnlyGuard).
      expect(String(conn['accessTokenEnc']).startsWith('v1:')).toBe(false);
      expect(conn['refreshTokenEnc']).toBeUndefined();
    }
  });
});

describe('seedDemo — calendrier éco partagé', () => {
  const ecoWrites = (calls: Call[]) => calls.filter((c) => c.model === 'ecoEvent' && c.op !== 'findMany');
  const pinsUpdate = (calls: Call[]) =>
    calls.find((c) => c.model === 'user' && c.op === 'update' && 'pinnedEcoEvents' in (c.args['data'] as object));

  it('avec FMP branché : aucune écriture dans EcoEvent (partagé par tous les users)', async () => {
    const prev = process.env['FMP_API_KEY'];
    process.env['FMP_API_KEY'] = 'test-key';
    try {
      const calls: Call[] = [];
      await seedDemo(fakePrisma(calls).prisma);
      expect(ecoWrites(calls)).toHaveLength(0);
      expect((pinsUpdate(calls)?.args['data'] as Record<string, unknown>)['pinnedEcoDate']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    } finally {
      if (prev === undefined) delete process.env['FMP_API_KEY']; else process.env['FMP_API_KEY'] = prev;
    }
  });

  it('sans FMP (local) : faux calendrier du jour et épingles datées du jour', async () => {
    const prev = process.env['FMP_API_KEY'];
    delete process.env['FMP_API_KEY'];
    try {
      const calls: Call[] = [];
      await seedDemo(fakePrisma(calls).prisma);
      expect(ecoWrites(calls).length).toBeGreaterThan(0);
      const data = pinsUpdate(calls)?.args['data'] as Record<string, unknown>;
      expect(data['pinnedEcoEvents']).toHaveLength(2);
      expect(data['pinnedEcoDate']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    } finally {
      if (prev !== undefined) process.env['FMP_API_KEY'] = prev;
    }
  });
});

describe('seedDemo — réalisme validé : un trader crédible, pas un gagnant parfait', () => {
  const net = (t: Record<string, unknown>) => (t['pnl'] as number) - (t['commission'] as number);
  const dayKey = (t: Record<string, unknown>) => (t['tradedAt'] as Date).toDateString();

  it('des frais réels sur chaque trade : le net est visiblement sous le brut', async () => {
    const { prisma, created } = fakePrisma([]);
    const res = await seedDemo(prisma);

    const closed = created['trade'].filter((t) => t['pnl'] !== null);
    expect(closed.every((t) => (t['commission'] as number) > 0)).toBe(true);
    // Seule exception : la position encore ouverte de la session live (ni sortie, ni P&L, ni frais).
    expect(created['trade'].filter((t) => t['pnl'] === null)).toHaveLength(1);
    expect(res.fees).toBeGreaterThan(400);
    expect(res.grossPnl - res.pnl).toBeCloseTo(res.fees, 1);
    expect(res.pnl).toBeLessThan(res.grossPnl);
  });

  it('win rate NET crédible (52-57 %) et ~40 % de journées rouges', async () => {
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma);

    const trades = activeTrades(created); // jeu de données principal, sans les comptes perdus
    const wins = trades.filter((t) => net(t) > 0).length;
    const losses = trades.filter((t) => net(t) < 0).length;
    const wr = (wins / (wins + losses)) * 100;
    expect(wr).toBeGreaterThanOrEqual(52);
    expect(wr).toBeLessThanOrEqual(57);

    const byDay = new Map<string, number>();
    for (const t of trades) byDay.set(dayKey(t), (byDay.get(dayKey(t)) ?? 0) + net(t));
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

  it('le week-end : session live quand même (vitrine), marché fermé, position gardée depuis vendredi', async () => {
    const now = saturdayAt(11);
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma, now);

    const active = created['tradeSession'].filter((x) => x['status'] === 'ACTIVE');
    expect(active).toHaveLength(1);
    expect((active[0]['startedAt'] as Date) <= now).toBe(true);
    // Aucun trade daté du week-end ; dernier trade clôturé et position ouverte : vendredi.
    const last = Math.max(...created['trade'].filter((t) => t['pnl'] !== null).map((t) => (t['tradedAt'] as Date).getTime()));
    expect(new Date(last).getDay()).toBe(5);
    const open = created['trade'].filter((t) => t['pnl'] === null);
    expect(open).toHaveLength(1);
    expect((open[0]['tradedAt'] as Date).getDay()).toBe(5);
    // Faux Prisma : id = `<modèle>-<rang de création>` ; la position est rattachée à la session live.
    expect(open[0]['sessionId']).toBe(`tradeSession-${created['tradeSession'].indexOf(active[0]) + 1}`);
    expect(open[0]['stopLoss']).not.toBeNull();
    expect(open[0]['takeProfit']).not.toBeNull();
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
    expect(insights.accounts).toHaveLength(3);
    expect(insights.summary).toMatch(/frais/);
    expect(created['dailyRecap'].length).toBe(res.tradingDays - 1); // tous sauf aujourd'hui
  });
});

describe('seedDemo — dates relatives au run (cron quotidien de 03:20)', () => {
  it('à 03:20 (avant l’ouverture) : aucun trade du jour, session live avec la position d’hier, récap daté d’hier', async () => {
    const now = weekdayAt(3, 20);
    const { prisma, created } = fakePrisma([]);
    await seedDemo(prisma, now);

    expect(created['trade'].filter((t) => (t['tradedAt'] as Date) > now)).toHaveLength(0);
    // Plus de trades « du jour » à 01:40 / 02:45 : la séance du jour attend l'ouverture. La vitrine
    // montre quand même une session live, avec la position ouverte la veille au soir.
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    expect(created['trade'].filter((t) => (t['tradedAt'] as Date) >= startOfDay)).toHaveLength(0);
    expect(created['tradeSession'].filter((x) => x['status'] === 'ACTIVE')).toHaveLength(1);
    expect(created['trade'].filter((t) => t['pnl'] === null)).toHaveLength(1);

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const yesterday = new Date(startOfToday);
    yesterday.setDate(yesterday.getDate() - 1);
    const recapDates = created['dailyRecap'].map((r) => (r['date'] as Date).getTime());
    expect(recapDates).toContain(yesterday.getTime());
    expect(Math.max(...recapDates)).toBe(yesterday.getTime());
    expect(created['weeklyDebrief'].some((w) =>
      JSON.stringify(w['insights']).includes('Séances suivies en direct'))).toBe(true);
  });

  it('séance du jour aux heures de marché, sur le compte Apex connecté : Londres le matin, New York l’après-midi', async () => {
    for (const [hour, first, last] of [[11, '09:22', '09:38'], [18, '15:38', '15:57']] as const) {
      const now = weekdayAt(hour);
      const { prisma, created } = fakePrisma([]);
      await seedDemo(prisma, now);
      const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
      const today = created['trade'].filter((t) => (t['tradedAt'] as Date) >= startOfToday && t['pnl'] !== null);
      const hhmm = (d: Date) => d.toTimeString().slice(0, 5);
      expect(today.map((t) => hhmm(t['tradedAt'] as Date)), `séance de ${hour} h`).toEqual([first, last]);
      // Puis une position encore ouverte, 4 min après le dernier trade (barre SL / TP de la vitrine).
      const open = created['trade'].filter((t) => t['pnl'] === null);
      expect(open).toHaveLength(1);
      expect((open[0]['tradedAt'] as Date) < now).toBe(true);
      expect(today.every((t) => t['accountId'] === 'tradingAccount-1')).toBe(true); // Apex
      const active = created['tradeSession'].filter((x) => x['status'] === 'ACTIVE');
      expect(active).toHaveLength(1);
      expect(active[0]['accountId']).toBe('tradingAccount-1');
      // Séance démarrée 25 min avant le premier trade, jamais en pleine nuit.
      expect((active[0]['startedAt'] as Date).getHours()).toBeGreaterThanOrEqual(8);
    }
  });

  it('la journée de revenge tombe dans la semaine du dernier débrief (celui affiché), jamais la veille', async () => {
    for (const now of [weekdayAt(10), saturdayAt(11), mondayAt(9)]) {
      const { prisma, created } = fakePrisma([]);
      await seedDemo(prisma, now);
      const revenge = created['trade'].find((t) => t['emotion'] === 'REVENGE')!;
      const latest = created['weeklyDebrief'].reduce((a, b) =>
        ((b['startDate'] as Date) > (a['startDate'] as Date) ? b : a));
      const at = revenge['tradedAt'] as Date;
      expect(at >= (latest['startDate'] as Date) && at <= (latest['endDate'] as Date), `seed du ${now.toISOString()}`).toBe(true);
      expect(JSON.stringify(latest['insights'])).toContain('Anti-tilt');
      const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
      expect(startOfToday.getTime() - at.getTime()).toBeGreaterThan(24 * 3600_000);
    }
  });
});
