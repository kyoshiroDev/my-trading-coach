import { hashPassword } from '../auth/password-hashing';
import { PrismaClient, SessionStatus, AccountStatus, BrokerProvider, BrokerConnectionStatus } from '@prisma/client';
import { computeTradeStats } from '@mtc/shared';
import { seedDefaultSetups } from '../setups/setups.defaults';
import { type AccountKey, APEX_DAILY_LOSS_LIMIT, DEMO_ACCOUNTS, DEMO_EMAIL, round2 } from './demo-data/config';
import { ONELINERS, PLANS, REFLECTIONS_GREEN, REFLECTIONS_RED, REFLECTION_REVENGE } from './demo-data/texts';
import { type DemoDay, type DemoStats, net } from './demo-data/model';
import { assertDemoCalendar, buildDemoDataset, dayAt } from './demo-data/generate';
import { PROFILE, isoWeek, setupRanking, usd } from './demo-data/reports';
import { tradingDay } from '../accounts/account-rules';
import { buildDemoRiskJournal, dayRiskLine, weekRiskNote } from './demo-data/prop-risk';
import { classifyEcoEvent } from '../eco-calendar/eco-calendar.impact';


/**
 * Seed du compte DÉMO vitrine (landing + formateurs) : source de vérité unique, utilisée par
 * l'endpoint admin, le cron quotidien (DemoSeedCron) et le script standalone.
 *
 * Objectif : un trader RÉALISTE, pas un gagnant parfait. Deux comptes prop firm en
 * USD, futures d'indices US uniquement (MES / MNQ / ES / NQ), jours ouvrés, frais réels qui
 * pèsent sur le net, ~40 % de journées rouges, une journée de revenge trading, des setups aux
 * résultats contrastés (dont un Scalping positif en brut mais NÉGATIF en net).
 *
 * - IDEMPOTENT : upsert du user + purge/recréation de SES données uniquement (scopé userId démo).
 * - Dates RELATIVES au moment du run (`now`) : après le cron de 03:20, la session du jour est
 *   aujourd'hui, le récap est hier ; rien n'est ré-ancré dans le passé. Les trades du jour sont
 *   placés AVANT `now` (jamais dans le futur, même quand le seed tourne à 03:20).
 * - Déterministe : PRNG seedé, puis recherche du premier tirage qui respecte les contraintes de
 *   crédibilité (`meetsTargets`) ; même `now` → mêmes données.
 */

export interface DemoSeedResult {
  email: string; trades: number; winRate: number; pnl: number;
  grossPnl: number; fees: number; redDays: number; tradingDays: number;
  sessions: number; recaps: number; debriefs: number; accounts: number;
  bySetup: DemoStats['bySetup']; byAccount: DemoStats['byAccount'];
}

/** Seed/refresh complet du compte démo. `prisma` = PrismaService ou PrismaClient adapter. */
export async function seedDemo(prisma: PrismaClient, now: Date = new Date()): Promise<DemoSeedResult> {
  const dataset = buildDemoDataset(now);
  assertDemoCalendar(dataset.days); // aucune écriture si un trade tombe un week-end ou hors futures
  const password = await hashPassword(`demo-${Date.now()}-${Math.random()}`);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { ...PROFILE },
    create: { email: DEMO_EMAIL, password, ...PROFILE },
  });
  return seedTradingData(prisma, user, now, { brokerShowcase: true, dataset });
}

export interface SeedTradingDataOptions {
  /** Fausse connexion Tradovate « Connecté » (vitrine du compte démo, lecture seule). Jamais sur un vrai compte. */
  brokerShowcase: boolean;
  /** Jeu de données déjà construit et vérifié par l'appelant. */
  dataset?: ReturnType<typeof buildDemoDataset>;
}

/**
 * Remplit un compte existant avec le jeu de données du compte démo : ses comptes de trading, ~6 semaines
 * de sessions et de trades, récaps quotidiens, débriefs hebdo, calendrier éco du jour.
 *
 * ⚠️ PURGE d'abord les trades, sessions, comptes, connexions broker, débriefs et récaps de CE user.
 * Réservé au compte démo et aux comptes de test (script `seed:user`, bases beta/locales uniquement).
 */
export async function seedTradingData(
  prisma: PrismaClient,
  user: { id: string; email: string },
  now: Date = new Date(),
  opts: SeedTradingDataOptions = { brokerShowcase: false },
): Promise<DemoSeedResult> {
  const { days, stats } = opts.dataset ?? buildDemoDataset(now);
  if (!opts.dataset) assertDemoCalendar(days);

  // Purge scopée (trades d'abord, FK session ; comptes APRÈS trades et sessions : onDelete SetNull).
  await prisma.trade.deleteMany({ where: { userId: user.id } });
  await prisma.tradeSession.deleteMany({ where: { userId: user.id } });
  await prisma.brokerConnection.deleteMany({ where: { userId: user.id } });
  await prisma.tradingAccount.deleteMany({ where: { userId: user.id } });
  await prisma.weeklyDebrief.deleteMany({ where: { userId: user.id } });
  await prisma.dailyRecap.deleteMany({ where: { userId: user.id } });

  const accountIdByKey = new Map<AccountKey, string>();
  // Plans du catalogue (synchronisé au démarrage de l'API) : seed lancé sur une base pas encore
  // synchronisée → compte non relié, la marge retombe sur les champs manuels.
  const catalogPlans = new Set(
    (await prisma.propFirmPlan.findMany({
      where: { id: { in: DEMO_ACCOUNTS.map((a) => a.propFirmPlanId) }, active: true },
      select: { id: true },
    })).map((p) => p.id),
  );
  for (const a of DEMO_ACCOUNTS) {
    const created = await prisma.tradingAccount.create({
      data: {
        userId: user.id, label: a.label, broker: a.broker, type: a.type,
        status: AccountStatus.ACTIVE, accountSize: a.accountSize,
        startingBalance: a.startingBalance, profitTarget: a.profitTarget,
        maxDrawdown: a.maxDrawdown, drawdownType: a.drawdownType, currency: 'USD',
        propFirmPlanId: catalogPlans.has(a.propFirmPlanId) ? a.propFirmPlanId : null,
      },
    });
    accountIdByKey.set(a.key, created.id);
  }

  await seedDefaultSetups(prisma, user.id);
  const demoSetups = await prisma.setup.findMany({ where: { userId: user.id }, select: { id: true, title: true } });
  const setupIdByTitle = new Map(demoSetups.map((s) => [s.title, s.id]));
  const setupIdFor = (title: string): string => setupIdByTitle.get(title) ?? demoSetups[0].id;

  // Sessions (une par jour de trading) + trades rattachés.
  let reflectionToggle = 0;
  for (const d of days) {
    if (!d.trades.length) continue;
    const first = d.trades[0].tradedAt, last = d.trades[d.trades.length - 1].tradedAt;
    const dayStats = computeTradeStats(d.trades);
    let cum = 0, peak = 0, maxDd = 0;
    for (const t of d.trades) { cum += net(t); peak = Math.max(peak, cum); maxDd = Math.min(maxDd, cum - peak); }
    const best = d.trades.reduce((a, b) => (net(b) > net(a) ? b : a));
    const green = dayStats.totalPnl >= 0;
    const reflection =
      d.kind === 'revenge' ? REFLECTION_REVENGE
        : d.kind === 'today' ? null
          : d.kind === 'yesterday' || reflectionToggle++ % 2 === 0
            ? (green ? REFLECTIONS_GREEN : REFLECTIONS_RED)[d.daysAgo % 3]
            : null;
    const isToday = d.kind === 'today';
    // Session du jour : jamais démarrée la veille, même si le seed tourne juste après minuit.
    const dayStart = new Date(first); dayStart.setHours(0, 0, 0, 0);
    const session = await prisma.tradeSession.create({
      data: {
        userId: user.id, accountId: accountIdByKey.get(d.account)!,
        startedAt: new Date(Math.max(dayStart.getTime(), first.getTime() - 25 * 60_000)),
        endedAt: isToday ? null : new Date(last.getTime() + 20 * 60_000),
        status: isToday ? SessionStatus.ACTIVE : SessionStatus.CLOSED,
        moodStart: d.moodStart, moodEnd: isToday ? null : d.moodEnd,
        planNote: PLANS[d.daysAgo % PLANS.length],
        reflectionNote: reflection,
        reflectionQuestion: "As-tu respecté ton plan de trading aujourd'hui ?",
        // Stats figées des sessions clôturées (le live du jour se calcule via getTodayTrades).
        ...(isToday ? {} : {
          totalPnl: dayStats.totalPnl, totalTrades: d.trades.length, winRate: dayStats.winRate,
          maxDrawdown: round2(maxDd), bestTradePnl: round2(net(best)), bestTradeAsset: best.asset,
        }),
      },
    });
    for (const t of d.trades) {
      await prisma.trade.create({
        data: {
          userId: user.id, accountId: accountIdByKey.get(t.account)!, sessionId: session.id,
          asset: t.asset, side: t.side, entry: t.entry, exit: t.exit,
          stopLoss: t.stopLoss, takeProfit: t.takeProfit, riskReward: t.riskReward,
          quantity: t.quantity, pnl: t.pnl, commission: t.commission, emotion: t.emotion,
          setupId: setupIdFor(t.setup), session: t.session, timeframe: t.timeframe,
          notes: t.notes, tags: ['DEMO'], tradedAt: t.tradedAt,
          executionScore: t.executionScore, executionGrade: t.executionGrade, executionMethod: t.executionMethod,
        },
      });
    }
  }

  // Journal de risque du compte Apex connecté (#373) : ce que le suivi en direct aurait relevé
  // (marges, alertes, tilt). Seul un compte synchronisé est suivi en direct, d'où la vitrine.
  const apex = DEMO_ACCOUNTS.find((x) => x.key === 'apex')!;
  const journal = opts.brokerShowcase
    ? buildDemoRiskJournal(days.flatMap((d) => d.trades).filter((t) => t.account === 'apex'), {
      startingBalance: apex.startingBalance, maxDrawdown: apex.maxDrawdown, dailyLossLimit: APEX_DAILY_LOSS_LIMIT,
    })
    : { days: [], events: [] };
  const sessionOf = (d: DemoDay) => (d.account === 'apex' && d.trades.length ? tradingDay(d.trades[0].tradedAt) : null);

  // Récaps quotidiens (J-1 → J-42) : chiffres NETS du jour, phrase selon le type de journée.
  let recaps = 0;
  for (const d of days) {
    if (d.kind === 'today' || !d.trades.length) continue;
    const s = computeTradeStats(d.trades);
    const gross = d.trades.reduce((a, t) => a + t.pnl, 0);
    // Journée avec alerte ou tilt : le récap Premium en parle d'abord (#374).
    const riskLine = dayRiskLine(journal.days.find((j) => j.day === sessionOf(d)), journal.events.filter((e) => e.day === sessionOf(d)));
    const line = riskLine ?? (d.kind === 'revenge' ? ONELINERS.revenge[0]
      : s.totalPnl < 0 ? ONELINERS.red[d.daysAgo % 2]
        : gross > 0 && s.totalPnl < 25 ? ONELINERS.fees[0]
          : ONELINERS.green[d.daysAgo % 2]);
    const emo = new Map<string, number>();
    for (const t of d.trades) { const e = t.emotion ?? d.moodStart; emo.set(e, (emo.get(e) ?? 0) + 1); }
    const dominant = [...emo.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const date = dayAt(now, d.daysAgo, 0, 0);
    await prisma.dailyRecap.create({
      data: { userId: user.id, date, tradesCount: d.trades.length, pnl: s.totalPnl, winRate: s.winRate, dominantEmotion: dominant, aiOneLiner: line },
    });
    recaps++;
  }

  // Débriefs hebdo : une semaine ISO TERMINÉE = un débrief, textes calculés sur ses trades.
  const thisWeek = isoWeek(now);
  const weeks = new Map<string, { week: number; year: number; days: DemoDay[] }>();
  for (const d of days) {
    const w = isoWeek(dayAt(now, d.daysAgo, 12, 0));
    if (w.week === thisWeek.week && w.year === thisWeek.year) continue;
    const k = `${w.year}-${w.week}`;
    if (!weeks.has(k)) weeks.set(k, { ...w, days: [] });
    weeks.get(k)!.days.push(d);
  }
  let debriefs = 0;
  for (const w of weeks.values()) {
    const trades = w.days.flatMap((d) => d.trades);
    if (!trades.length) continue;
    const s = computeTradeStats(trades);
    const fees = trades.reduce((a, t) => a + t.commission, 0);
    const reds = w.days.filter((d) => d.trades.reduce((a, t) => a + net(t), 0) < 0).length;
    const { best, worst } = setupRanking(trades);
    const revenge = w.days.some((d) => d.kind === 'revenge');
    const summary =
      `Semaine ${s.totalPnl >= 0 ? 'positive' : 'négative'} : ${trades.length} trades, ${Math.round(s.winRate)} % de réussite nette, ` +
      `${usd(s.totalPnl)} net après ${usd(fees)} de frais. ${best[0]} reste ton meilleur setup (${usd(best[1])}), ` +
      `${worst[0]} te coûte ${usd(worst[1])}. ` +
      (revenge ? "La séance de revenge trading pèse lourd sur la semaine : c'est ta priorité n°1." : `${reds} journée(s) rouge(s), pertes globalement contrôlées.`);
    const strengths = [
      { badge: 'Force', text: `${best[0]} : ${usd(best[1])} net sur la semaine` },
      { badge: 'Force', text: 'Stops respectés sur la majorité des trades avec stop' },
    ];
    const weaknesses = [
      { badge: 'Attention', text: `${worst[0]} : ${usd(worst[1])} net, à réduire ou à supprimer` },
      revenge
        ? { badge: 'Discipline', text: 'Revenge trading : ré-entrées en moins de 2 minutes, taille doublée' }
        : { badge: 'Frais', text: `${usd(fees)} de frais : le scalping sur 5 contrats coûte plus qu'il ne rapporte` },
    ];
    const objectives = [
      { title: '15 minutes de pause après une perte', reason: 'Tes pires séquences commencent juste après une perte.' },
      { title: 'Réduire le scalping', reason: 'Positif en brut, négatif une fois les frais payés.' },
      { title: 'Stop systématique sur chaque trade', reason: 'Tes trades sans stop concentrent les pertes les plus lourdes.' },
    ];
    const emotionInsight = 'Tes trades en état FOCALISÉ ou CONFIANT ont le meilleur résultat net ; STRESSÉ ou FATIGUÉ, tu prends des entrées moyennes.';
    const weekSessions = new Set(w.days.map(sessionOf).filter(Boolean));
    const riskNote = weekRiskNote(
      journal.days.filter((j) => weekSessions.has(j.day)),
      journal.events.filter((e) => weekSessions.has(e.day)),
    );
    const accounts = DEMO_ACCOUNTS.map((a) => {
      const at = trades.filter((t) => t.account === a.key);
      const as = computeTradeStats(at);
      return {
        accountId: accountIdByKey.get(a.key)!, name: a.label, type: a.type, status: 'ACTIVE',
        stats: { totalTrades: at.length, winRate: as.winRate, totalPnl: as.totalPnl },
        rules: { startingBalance: a.startingBalance, profitTarget: a.profitTarget, maxDrawdown: a.maxDrawdown, drawdownType: a.drawdownType },
        summary: at.length
          ? `${at.length} trades, ${usd(as.totalPnl)} net sur ${a.label}.`
          : `Aucun trade sur ${a.label} cette semaine.`,
        strengths: at.length ? [strengths[0]] : [],
        weaknesses: at.length ? [weaknesses[0]] : [],
        objectives: objectives.slice(0, 2),
        propNote: [
          a.key === 'apex' ? riskNote : null,
          a.profitTarget
            ? `Objectif ${usd(a.profitTarget)} : estimation d'après les trades loggés, pas le calcul officiel de la firme.`
            : `Compte funded : marge de drawdown estimée d'après les trades loggés, pas le calcul officiel de la firme.`,
        ].filter(Boolean).join(' '),
      };
    });
    const monday = dayAt(now, Math.max(...w.days.map((d) => d.daysAgo)), 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6); sunday.setHours(23, 59, 59, 0);
    await prisma.weeklyDebrief.create({
      data: {
        userId: user.id, weekNumber: w.week, year: w.year, startDate: monday, endDate: sunday,
        aiSummary: summary,
        insights: { overview: { summary }, accounts, summary, strengths, weaknesses, emotionInsight, objectives },
        objectives,
        stats: { winRate: s.winRate, totalPnl: s.totalPnl, totalTrades: trades.length },
      },
    });
    debriefs++;
  }

  // Calendrier éco du jour + 2 favoris épinglés (agenda pré-session + live).
  // `EcoEvent` est PARTAGÉ par tous les users : avec FMP branché (prod, dev), la démo lit le vrai
  // calendrier et épingle 2 de ses annonces. Les faux events n'existent que sans FMP (local,
  // tests) ; avant, ils étaient injectés chaque nuit dans le calendrier de tout le monde
  // (« CPI US » fantôme du lundi, « Balance courante » en double…).
  const today = now.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  const pinnedEcoEvents = process.env['FMP_API_KEY']
    ? await pickRealEcoPins(prisma, today)
    : await seedFakeEcoEvents(prisma, today);
  await prisma.user.update({
    where: { id: user.id },
    // Sans la date du jour, readUserPins jugeait la sélection expirée et la vidait aussitôt.
    data: { pinnedEcoEvents, pinnedEcoDate: today },
  });

  // Compte Apex « Connecté » à Tradovate (vitrine de la connexion broker) : aucun vrai token, le compte démo
  // ne peut ni synchroniser ni connecter (DemoReadOnlyGuard bloque les POST).
  const apexId = accountIdByKey.get('apex')!;
  const demoTradovateAccount = { id: '0', name: 'APEX-DEMO-01', env: 'demo' };
  // Jamais sur un vrai compte : le cron de renouvellement tenterait ce faux jeton en boucle.
  if (opts.brokerShowcase) await prisma.brokerConnection.create({
    data: {
      userId: user.id, accountId: apexId, provider: BrokerProvider.TRADOVATE,
      status: BrokerConnectionStatus.CONNECTED, accessTokenEnc: 'demo:aucun-token',
      accessTokenExpiresAt: new Date(now.getTime() + 80 * 60 * 1000),
      externalAccountId: demoTradovateAccount.id, externalAccountName: demoTradovateAccount.name,
      externalEnv: demoTradovateAccount.env, availableAccounts: [demoTradovateAccount],
      lastSyncAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      tradesImported: stats.byAccount['apex'].trades,
      // Solde « lu chez le broker » : cohérent avec les trades seedés (aucun écart), sans position
      // ouverte → equity = solde. Montre le suivi en direct sans inventer de latent.
      brokerCashBalance: round2(DEMO_ACCOUNTS.find((x) => x.key === 'apex')!.startingBalance + stats.byAccount['apex'].netPnl),
      brokerCashBalanceAt: new Date(now.getTime() - 4 * 60 * 1000),
      brokerNetLiq: round2(DEMO_ACCOUNTS.find((x) => x.key === 'apex')!.startingBalance + stats.byAccount['apex'].netPnl),
      brokerOpenPnl: 0,
      brokerEquityAt: new Date(now.getTime() - 4 * 60 * 1000),
      brokerOpenPositions: 0,
    },
  });

  // Clôtures « officielles » du compte connecté : solde à la fin de chaque séance tradée, tiré des
  // trades seedés (même convention de séance que le calcul : 17:00 heure de Chicago). La séance en
  // cours n'en a pas, comme chez le broker. Supprimées avec le compte (cascade).
  if (opts.brokerShowcase) {
    const startingBalance = DEMO_ACCOUNTS.find((x) => x.key === 'apex')!.startingBalance;
    const closeBySession = new Map<string, number>();
    let balance = startingBalance;
    const apexTrades = days.flatMap((d) => d.trades).filter((t) => t.account === 'apex')
      .sort((a, b) => a.tradedAt.getTime() - b.tradedAt.getTime());
    for (const t of apexTrades) {
      balance += net(t);
      closeBySession.set(tradingDay(t.tradedAt), round2(balance));
    }
    const currentSession = tradingDay(now);
    let previous = startingBalance;
    const closes = [...closeBySession].filter(([session]) => session < currentSession).map(([session, close]) => {
      const row = { accountId: apexId, tradeDate: new Date(`${session}T00:00:00.000Z`), closingBalance: close, realizedPnl: round2(close - previous) };
      previous = close;
      return row;
    });
    if (closes.length) await prisma.brokerDailyClose.createMany({ data: closes });
  }

  // Séances suivies en direct : supprimées avec le compte (cascade), recréées à chaque seed.
  if (journal.days.length) {
    await prisma.accountRiskDay.createMany({
      data: journal.days.map(({ day, ...r }) => ({ accountId: apexId, tradeDate: new Date(`${day}T00:00:00.000Z`), ...r })),
    });
  }
  if (journal.events.length) {
    await prisma.propRiskEvent.createMany({
      data: journal.events.map((e) => ({
        userId: user.id, accountId: apexId, tradeDate: new Date(`${e.day}T00:00:00.000Z`),
        kind: e.kind, level: e.level, data: e.data, createdAt: e.at,
      })),
    });
  }

  return {
    email: user.email, trades: stats.trades, winRate: Math.round(stats.winRateNet), pnl: stats.netPnl,
    grossPnl: stats.grossPnl, fees: stats.fees, redDays: stats.redDays, tradingDays: stats.tradingDays,
    sessions: days.filter((d) => d.trades.length).length, recaps, debriefs, accounts: DEMO_ACCOUNTS.length,
    bySetup: stats.bySetup, byAccount: stats.byAccount,
  };
}

/** Épingles démo = les 2 annonces les plus fortes du vrai calendrier du jour (clé affichée `nom:devise`). */
async function pickRealEcoPins(prisma: PrismaClient, today: string): Promise<string[]> {
  const rows = await prisma.ecoEvent.findMany({ where: { date: today }, orderBy: { time: 'asc' } });
  return rows
    .map((r) => ({
      r,
      impact: classifyEcoEvent({
        name: r.name, currency: r.currency, country: r.country,
        fmpImpact: r.impact === 'high' ? 'High' : 'Medium',
      }),
    }))
    .filter((x) => x.impact !== null)
    .sort((a, b) => Number(b.impact === 'high') - Number(a.impact === 'high'))
    .slice(0, 2)
    .map(({ r }) => `${r.nameFr ?? r.name}:${r.currency}`);
}

/** Sans FMP (local, tests) : un faux calendrier du jour, aux libellés FMP anglais, pour que la démo reste peuplée. */
async function seedFakeEcoEvents(prisma: PrismaClient, today: string): Promise<string[]> {
  const ecoEvents = [
    { time: '01:30', name: 'Tokyo CPI YoY', nameFr: 'Inflation Tokyo', currency: 'JPY', country: 'JP', impact: 'medium', actual: 2.5, estimate: 2.4, previous: 2.6, unit: '%' },
    { time: '10:00', name: 'HCOB Manufacturing PMI', nameFr: 'PMI manufacturier', currency: 'EUR', country: 'EU', impact: 'medium', actual: 49.2, estimate: 49.0, previous: 48.8, unit: null },
    { time: '14:30', name: 'CPI YoY', nameFr: 'Inflation CPI (US)', currency: 'USD', country: 'US', impact: 'high', actual: 3.1, estimate: 3.2, previous: 3.4, unit: '%' },
    { time: '16:00', name: 'ECB President Lagarde Speech', nameFr: 'Discours de Lagarde (BCE)', currency: 'EUR', country: 'EU', impact: 'high', actual: null, estimate: null, previous: null, unit: null },
  ];
  for (const e of ecoEvents) {
    const data = {
      time: e.time, nameFr: e.nameFr, country: e.country, impact: e.impact,
      actual: e.actual, estimate: e.estimate, previous: e.previous, isReleased: e.actual !== null, unit: e.unit,
    };
    await prisma.ecoEvent.upsert({
      where: { date_name_currency: { date: today, name: e.name, currency: e.currency } },
      update: data,
      create: { date: today, name: e.name, currency: e.currency, ...data },
    });
  }
  return ['Inflation CPI (US):USD', 'Discours de Lagarde (BCE):EUR'];
}

// Réexports : API publique historique de ce module (cron, service, spec, script).
export { DEMO_EMAIL, DEMO_WINDOW_DAYS } from './demo-data/config';
export { meetsTargets } from './demo-data/model';
export { assertDemoCalendar, buildDemoDataset } from './demo-data/generate';
export type { DemoDay, DemoStats, DemoTrade } from './demo-data/model';
