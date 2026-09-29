// Génération déterministe des journées démo (PRNG seedé) puis notation d'exécution de chaque trade.
import { TradeSide, EmotionState, TradingSession, MoodState, ExecutionMethod } from '@prisma/client';
import { BEHAVIORAL_MIN_TRADES, computeBehavioralGrade, computeExecutionGrade, median } from '@api/common/utils/execution-grade.util';
import { type AccountKey, DEMO_ACCOUNTS, DEMO_WINDOW_DAYS, INSTRUMENTS, type Rand, SETUP_PROFILES, type SetupTitle, type Sym, between, pick, rng, round2, toTick } from './config';
import { NOTES_LOSS, NOTES_WIN } from './texts';
import { type DemoDay, type DemoStats, type DemoTrade, meetsTargets, net, statsOf } from './model';

// ── Génération ─────────────────────────────────────────────────────────────

export function sessionOf(hour: number): TradingSession {
  if (hour < 8) return TradingSession.ASIAN;
  if (hour < 14) return TradingSession.LONDON;
  return TradingSession.NEW_YORK;
}

export function buildTrade(
  r: Rand,
  o: {
    account: AccountKey; setup: SetupTitle; win: boolean; asset: Sym; quantity: number;
    at: Date; daysAgo: number; moodStart: MoodState; forceNoStop?: boolean; lossMult?: number;
    emotion?: EmotionState | null;
  },
): DemoTrade {
  const inst = INSTRUMENTS[o.asset];
  const prof = SETUP_PROFILES[o.setup];
  const stopPts = toTick(between(r, inst.stop) * (o.setup === 'Scalping' ? 0.4 : 1));
  const mult = o.win ? between(r, prof.win) : (o.lossMult ?? between(r, prof.loss));
  const points = toTick(stopPts * mult);
  const side: TradeSide = r() < 0.6 ? TradeSide.LONG : TradeSide.SHORT;
  const dir = side === TradeSide.LONG ? 1 : -1;
  const entry = toTick(inst.base * (1 + (r() - 0.5) * 0.03));
  const exit = entry + dir * (o.win ? points : -points);
  const withStop = !o.forceNoStop && r() < prof.stopRate;
  const targetPts = toTick(stopPts * prof.win[1]);
  const stopLoss = withStop ? entry - dir * stopPts : null;
  const takeProfit = withStop ? entry + dir * targetPts : null;
  const riskReward = withStop ? Math.round((targetPts / stopPts) * 10) / 10 : null;
  const pnl = round2((exit - entry) * dir * inst.ptVal * o.quantity);
  const emotion =
    o.emotion !== undefined ? o.emotion
      : r() < 0.3 ? (o.win ? pick(r, ['CONFIDENT', 'FOCUSED'] as EmotionState[]) : pick(r, ['STRESSED', 'FEAR'] as EmotionState[]))
        : null;
  const notes = r() < 0.3 ? pick(r, o.win ? NOTES_WIN : NOTES_LOSS) : null;
  return {
    account: o.account, asset: o.asset, setup: o.setup, side, entry, exit, stopLoss, takeProfit,
    riskReward, quantity: o.quantity, pnl, commission: round2(inst.fee * o.quantity), emotion,
    timeframe: prof.tf, session: sessionOf(o.at.getHours()), tradedAt: o.at, notes,
    daysAgo: o.daysAgo, executionScore: null, executionGrade: null, executionMethod: null,
  };
}

/** Date `daysAgo` jours avant `now`, à hh:mm locales. */
export function dayAt(now: Date, daysAgo: number, hour: number, minute: number): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d;
}

export function assetFor(r: Rand, setup: SetupTitle): Sym {
  if (setup === 'Scalping') return r() < 0.6 ? 'MNQ' : 'MES';
  const x = r();
  return x < 0.45 ? 'MNQ' : x < 0.8 ? 'MES' : x < 0.9 ? 'NQ' : 'ES';
}
export function quantityFor(r: Rand, asset: Sym, setup: SetupTitle): number {
  if (asset === 'NQ' || asset === 'ES') return 1;
  if (setup === 'Scalping') return 6;
  return 3 + Math.floor(r() * 3); // 3 à 5 micros
}

export function generate(now: Date, seed: number): DemoDay[] {
  const r = rng(seed);
  // JOURS OUVRÉS UNIQUEMENT (lundi-vendredi), y compris « aujourd'hui » et le dernier jour :
  // les futures ne tradent pas le week-end. Le samedi / dimanche, pas de session live ni de trade
  // du jour. « lastDay » = dernier jour ouvré avant aujourd'hui (carte « Hier », récap).
  const isWeekday = (d: number) => { const wd = dayAt(now, d, 12, 0).getDay(); return wd !== 0 && wd !== 6; };
  const tradesToday = isWeekday(0);
  let lastDay = 1;
  while (!isWeekday(lastDay)) lastDay++;
  const weekdays: number[] = [];
  for (let d = DEMO_WINDOW_DAYS; d > lastDay; d--) if (isWeekday(d)) weekdays.push(d);
  // Journée de revenge : premier jour ouvré à ~3 semaines.
  const revengeDay = weekdays.find((d) => d <= 18) ?? weekdays[Math.floor(weekdays.length / 2)];
  const normalDays = weekdays.filter((d) => d !== revengeDay);

  // Nombre de trades par jour (2 à 4), puis quotas exacts par setup (win rate maîtrisé).
  const counts = normalDays.map(() => { const x = r(); return x < 0.4 ? 2 : x < 0.8 ? 3 : 4; });
  const total = counts.reduce((a, b) => a + b, 0);
  const setupsList = Object.keys(SETUP_PROFILES) as SetupTitle[];
  const pool: { setup: SetupTitle; win: boolean }[] = [];
  let remaining = total;
  setupsList.forEach((s, i) => {
    const n = i === setupsList.length - 1 ? remaining : Math.round(total * SETUP_PROFILES[s].share);
    remaining -= n;
    const wins = Math.round(n * SETUP_PROFILES[s].wr);
    for (let k = 0; k < n; k++) pool.push({ setup: s, win: k < wins });
  });
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }

  const days: DemoDay[] = [];
  const moods: MoodState[] = ['FOCUSED', 'CONFIDENT', 'NEUTRAL', 'TIRED', 'STRESSED'];
  let p = 0;
  normalDays.forEach((daysAgo, i) => {
    const account: AccountKey = r() < 0.3 ? 'tradeify' : 'apex';
    const moodStart = pick(r, moods);
    const ny = r() < 0.45;
    let minutes = (ny ? 15 * 60 + 32 : 9 * 60 + 5) + Math.floor(r() * 20);
    const trades: DemoTrade[] = [];
    for (let k = 0; k < counts[i]; k++) {
      const slot = pool[p++];
      const asset = assetFor(r, slot.setup);
      const at = slot.setup === 'News'
        ? dayAt(now, daysAgo, 14, 31 + Math.floor(r() * 8))
        : dayAt(now, daysAgo, Math.floor(minutes / 60), minutes % 60);
      trades.push(buildTrade(r, {
        account, setup: slot.setup, win: slot.win, asset, quantity: quantityFor(r, asset, slot.setup),
        at, daysAgo, moodStart,
      }));
      minutes += 25 + Math.floor(r() * 55);
    }
    trades.sort((a, b) => a.tradedAt.getTime() - b.tradedAt.getTime());
    const dayNet = trades.reduce((a, t) => a + net(t), 0);
    days.push({
      daysAgo, account, moodStart, kind: 'normal', trades,
      moodEnd: dayNet >= 0 ? pick(r, ['CONFIDENT', 'FOCUSED'] as MoodState[]) : pick(r, ['NEUTRAL', 'TIRED', 'STRESSED'] as MoodState[]),
    });
  });

  // Journée de revenge (compte Apex, MNQ) : une perte, puis deux ré-entrées en < 2 min, taille doublée, sans stop.
  {
    const d = revengeDay;
    const t1 = buildTrade(r, { account: 'apex', setup: 'Range', win: false, asset: 'MNQ', quantity: 4, at: dayAt(now, d, 15, 41), daysAgo: d, moodStart: 'STRESSED', lossMult: 0.95, emotion: 'STRESSED' });
    const t2 = buildTrade(r, { account: 'apex', setup: 'Reversal', win: false, asset: 'MNQ', quantity: 8, at: dayAt(now, d, 15, 42), daysAgo: d, moodStart: 'STRESSED', forceNoStop: true, lossMult: 1.2, emotion: 'REVENGE' });
    const t3 = buildTrade(r, { account: 'apex', setup: 'Reversal', win: false, asset: 'MNQ', quantity: 8, at: dayAt(now, d, 15, 44), daysAgo: d, moodStart: 'STRESSED', forceNoStop: true, lossMult: 0.9, emotion: 'REVENGE' });
    t2.notes = 'Revenge : ré-entrée immédiate pour « récupérer » la perte, taille doublée, pas de stop.';
    days.push({ daysAgo: d, account: 'apex', moodStart: 'STRESSED', moodEnd: 'TIRED', kind: 'revenge', trades: [t1, t2, t3] });
  }

  // Dernier jour ouvré (J-1, ou le vendredi le week-end / le lundi) : journée propre, légèrement verte.
  {
    const d = lastDay;
    const a = buildTrade(r, { account: 'apex', setup: 'Breakout', win: true, asset: 'MNQ', quantity: 3, at: dayAt(now, d, 9, 22), daysAgo: d, moodStart: 'FOCUSED', emotion: 'FOCUSED' });
    const b = buildTrade(r, { account: 'apex', setup: 'Pullback', win: false, asset: 'MES', quantity: 2, at: dayAt(now, d, 15, 47), daysAgo: d, moodStart: 'FOCUSED', lossMult: 0.75, emotion: null });
    days.push({ daysAgo: d, account: 'apex', moodStart: 'FOCUSED', moodEnd: 'CONFIDENT', kind: 'yesterday', trades: [a, b] });
  }

  // Aujourd'hui (J-0), jour ouvré seulement : session ACTIVE, trades placés AVANT `now`.
  if (tradesToday) {
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const clamp = (ms: number) => new Date(Math.max(startOfDay.getTime() + 5 * 60_000, ms));
    const a = buildTrade(r, { account: 'apex', setup: 'Breakout', win: true, asset: 'MNQ', quantity: 3, at: clamp(now.getTime() - 100 * 60_000), daysAgo: 0, moodStart: 'FOCUSED', emotion: 'CONFIDENT' });
    const b = buildTrade(r, { account: 'apex', setup: 'Scalping', win: true, asset: 'MES', quantity: 5, at: clamp(now.getTime() - 35 * 60_000), daysAgo: 0, moodStart: 'FOCUSED', forceNoStop: true, emotion: null });
    days.push({ daysAgo: 0, account: 'apex', moodStart: 'FOCUSED', moodEnd: 'CONFIDENT', kind: 'today', trades: [a, b] });
  }

  days.sort((x, y) => y.daysAgo - x.daysAgo);
  gradeAll(days);
  assertDemoCalendar(days);
  return days;
}

/**
 * Garde-fou : la démo montre un trader de futures d'indices US. Aucun trade un
 * samedi ou un dimanche, aucun actif hors MES / MNQ / ES / NQ. Appelé avant TOUTE écriture :
 * une régression fait échouer le seed au lieu d'afficher une démo incohérente.
 */
export function assertDemoCalendar(days: { trades: { tradedAt: Date; asset: string }[] }[]): void {
  for (const t of days.flatMap((d) => d.trades)) {
    const wd = t.tradedAt.getDay();
    if (wd === 0 || wd === 6) {
      throw new Error(`Seed démo : trade un week-end (${t.tradedAt.toISOString()}), refusé.`);
    }
    if (!(t.asset in INSTRUMENTS)) {
      throw new Error(`Seed démo : actif ${t.asset} hors futures d'indices US, refusé.`);
    }
  }
}

/** Note d'exécution, comme en prod : barème A (stop) par trade, barème B (comportemental) par compte. */
export function gradeAll(days: DemoDay[]): void {
  const account = { startingBalance: 50_000, accountSize: 50_000 };
  for (const d of days) {
    for (const t of d.trades) {
      if (t.stopLoss == null) continue;
      const g = computeExecutionGrade(
        { side: t.side, entry: t.entry, exit: t.exit, stopLoss: t.stopLoss, takeProfit: t.takeProfit,
          riskReward: t.riskReward, emotion: t.emotion, tradeSession: { moodStart: d.moodStart } },
        account,
      );
      t.executionScore = g.score; t.executionGrade = g.grade;
      t.executionMethod = g.score != null ? ExecutionMethod.STOP_BASED : null;
    }
  }
  // Barème B : même algorithme que TradesService.recomputeBehavioralGrades (médianes par compte).
  for (const a of DEMO_ACCOUNTS) {
    const ts = days.flatMap((d) => d.trades).filter((t) => t.account === a.key)
      .sort((x, y) => x.tradedAt.getTime() - y.tradedAt.getTime());
    if (ts.length < BEHAVIORAL_MIN_TRADES) continue;
    const isLoss = (t: DemoTrade) => t.pnl < 0;
    const medianLoss = median(ts.filter(isLoss).map((t) => Math.abs(t.pnl)));
    const medianQuantity = median(ts.map((t) => t.quantity));
    ts.forEach((t, i) => {
      if (t.stopLoss != null) return;
      const day = t.tradedAt.toISOString().slice(0, 10);
      let lastSameDayLossAt: Date | null = null;
      for (let j = i - 1; j >= 0; j--) {
        if (ts[j].tradedAt.toISOString().slice(0, 10) !== day) break;
        if (isLoss(ts[j])) { lastSameDayLossAt = ts[j].tradedAt; break; }
      }
      const g = computeBehavioralGrade({
        pnl: t.pnl, quantity: t.quantity, tradedAt: t.tradedAt, medianLoss, medianQuantity,
        previousIsLoss: i > 0 && isLoss(ts[i - 1]), lastSameDayLossAt,
      });
      t.executionScore = g.score; t.executionGrade = g.grade;
      t.executionMethod = g.score != null ? ExecutionMethod.BEHAVIORAL : null;
    });
  }
}

/**
 * Jeu de données démo pour `now` : premier tirage (seeds successifs, déterministes) qui respecte
 * les contraintes de crédibilité. Pur (aucune base) : testé et affiché sans Prisma.
 */
export function buildDemoDataset(now: Date = new Date()): { days: DemoDay[]; stats: DemoStats; seed: number } {
  let last: { days: DemoDay[]; stats: DemoStats; seed: number } | null = null;
  for (let seed = 20260919; seed < 20260919 + 5_000; seed++) {
    const days = generate(now, seed);
    const stats = statsOf(days);
    last = { days, stats, seed };
    if (meetsTargets(stats)) return last;
  }
  return last!;
}

