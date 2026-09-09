// Seed "Mes comptes" pour tahir.gregory.dev@gmail.com (VPS dev) — prop firms RÉELLES
// avec leurs VRAIES règles (sources vérifiées juin 2026), + trades réalistes par compte.
// Génère du SQL sur stdout. Résumé (compte → trades, P&L, % objectif) sur stderr.
//
// Sources des règles :
//  - Apex Trader Funding 50K eval : objectif +$3 000, trailing drawdown $2 500 (intraday trailing)
//      apextraderfunding.com/help-center/intraday-trailing-drawdown-evaluations/
//  - Topstep Trading Combine 50K : objectif +$3 000, Max Loss Limit $2 000 (trailing EOD)
//      help.topstep.com/en/articles/8284197-trading-combine-parameters
//  - FTMO Challenge 100K : objectif Phase 1 +$10 000 (10%), perte max globale $10 000 (10%, statique)
//      ftmo.com/en/trading-objectives/
//  - MyFundedFutures Rapid 50K : objectif +$3 000, Max EOD trailing drawdown $2 000
//      help.myfundedfutures.com/en/articles/13134709-rapid-plan-50k-a-comprehensive-look
import { randomUUID } from 'node:crypto';

const USER_ID = 'cmot4b03n000001kjsrjsy8w7';
const LUCIDE_ID = 'cmqmn117x000101my5jnelxjn'; // placeholder à retirer (0 trade)
const cid = () => 'c' + randomUUID().replace(/-/g, '').slice(0, 24);
const r2 = (n) => Math.round(n * 100) / 100;
const sq = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
const arr = (a) => `'{${a.map((x) => `"${x}"`).join(',')}}'`;
const D = (day, h, m) => new Date(Date.UTC(2026, 5, day, h, m, 0)).toISOString();

// ── Comptes prop firm (règles réelles) ───────────────────────────────────────
const A_APEX = cid(), A_TOPSTEP = cid(), A_FTMO = cid(), A_MFF = cid();
const ACCOUNTS = [
  { id: A_APEX, label: 'Apex 50K', broker: 'Apex Trader Funding', type: 'EVALUATION', status: 'ACTIVE', size: 50000, start: 50000, target: 3000, maxDD: 2500, dd: 'TRAILING' },
  { id: A_TOPSTEP, label: 'Topstep 50K', broker: 'Topstep', type: 'EVALUATION', status: 'PASSED', size: 50000, start: 50000, target: 3000, maxDD: 2000, dd: 'TRAILING' },
  { id: A_FTMO, label: 'FTMO 100K', broker: 'FTMO', type: 'EVALUATION', status: 'ACTIVE', size: 100000, start: 100000, target: 10000, maxDD: 10000, dd: 'STATIC' },
  { id: A_MFF, label: 'MyFundedFutures Rapid 50K', broker: 'MyFundedFutures', type: 'FUNDED', status: 'ACTIVE', size: 50000, start: 50000, target: 3000, maxDD: 2000, dd: 'TRAILING' },
];

const NOTES = {
  BREAKOUT: "Cassure du range d'ouverture sur volume",
  PULLBACK: 'Repli sur la MM20 en tendance',
  REVERSAL: 'Divergence + rejet sur niveau clé',
  RANGE: 'Rejet sur la borne du range',
  SCALPING: 'Scalp rapide sur impulsion',
  NEWS: 'Réaction post-annonce éco',
};
const TAGS = {
  BREAKOUT: ['breakout', 'momentum'], PULLBACK: ['pullback', 'trend'],
  REVERSAL: ['reversal'], RANGE: ['range'], SCALPING: ['scalp'], NEWS: ['news'],
};

// Futures : [accId, asset, ptValue, day,h,m, side, session, entry, points, qty, emo, setup, tf]
const PV_MNQ = 2; // MNQ : 2 $/point/contrat
const futures = [
  // ── Apex 50K (MNQ) — éval en cours, ~+1 850 (≈62% de l'objectif 3 000) ──
  [A_APEX, 'MNQ', PV_MNQ, 2, 13, 45, 'LONG', 'NEW_YORK', 21318, 30, 11, 'FOCUSED', 'BREAKOUT', '5m'],
  [A_APEX, 'MNQ', PV_MNQ, 3, 14, 20, 'LONG', 'NEW_YORK', 21345, -16, 11, 'NEUTRAL', 'PULLBACK', '5m'],
  [A_APEX, 'MNQ', PV_MNQ, 4, 8, 40, 'SHORT', 'LONDON', 21440, 22, 11, 'FOCUSED', 'REVERSAL', '15m'],
  [A_APEX, 'MNQ', PV_MNQ, 5, 14, 0, 'LONG', 'NEW_YORK', 21515, 26, 11, 'CONFIDENT', 'BREAKOUT', '5m'],
  [A_APEX, 'MNQ', PV_MNQ, 9, 14, 10, 'LONG', 'NEW_YORK', 21615, -14, 11, 'STRESSED', 'PULLBACK', '5m'],
  [A_APEX, 'MNQ', PV_MNQ, 11, 8, 25, 'SHORT', 'LONDON', 21590, 28, 11, 'FOCUSED', 'REVERSAL', '15m'],
  [A_APEX, 'MNQ', PV_MNQ, 16, 14, 0, 'LONG', 'NEW_YORK', 21840, -12, 11, 'NEUTRAL', 'RANGE', '5m'],
  [A_APEX, 'MNQ', PV_MNQ, 17, 15, 10, 'LONG', 'NEW_YORK', 21900, 24, 11, 'CONFIDENT', 'BREAKOUT', '15m'],

  // ── Topstep 50K (MNQ) — VALIDÉ (PASSED), légèrement au-dessus de +3 000 ──
  [A_TOPSTEP, 'MNQ', PV_MNQ, 2, 14, 5, 'LONG', 'NEW_YORK', 21372, 34, 14, 'FOCUSED', 'BREAKOUT', '15m'],
  [A_TOPSTEP, 'MNQ', PV_MNQ, 3, 15, 5, 'LONG', 'NEW_YORK', 21295, -18, 14, 'NEUTRAL', 'PULLBACK', '5m'],
  [A_TOPSTEP, 'MNQ', PV_MNQ, 4, 14, 15, 'LONG', 'NEW_YORK', 21470, 28, 14, 'CONFIDENT', 'BREAKOUT', '5m'],
  [A_TOPSTEP, 'MNQ', PV_MNQ, 8, 13, 55, 'LONG', 'NEW_YORK', 21475, 30, 14, 'FOCUSED', 'BREAKOUT', '5m'],
  [A_TOPSTEP, 'MNQ', PV_MNQ, 10, 14, 40, 'SHORT', 'NEW_YORK', 21670, -16, 14, 'NEUTRAL', 'RANGE', '5m'],
  [A_TOPSTEP, 'MNQ', PV_MNQ, 12, 14, 5, 'LONG', 'NEW_YORK', 21710, 26, 14, 'CONFIDENT', 'PULLBACK', '15m'],
  [A_TOPSTEP, 'MNQ', PV_MNQ, 15, 15, 10, 'LONG', 'NEW_YORK', 21855, 32, 14, 'FOCUSED', 'BREAKOUT', '15m'],

  // ── MyFundedFutures Rapid 50K (MNQ) — FUNDED, en construction du payout, ~+1 300 ──
  [A_MFF, 'MNQ', PV_MNQ, 16, 13, 50, 'LONG', 'NEW_YORK', 21820, 22, 10, 'FOCUSED', 'BREAKOUT', '5m'],
  [A_MFF, 'MNQ', PV_MNQ, 17, 14, 30, 'SHORT', 'NEW_YORK', 21915, 18, 10, 'NEUTRAL', 'REVERSAL', '5m'],
  [A_MFF, 'MNQ', PV_MNQ, 18, 8, 35, 'LONG', 'LONDON', 21880, -12, 10, 'NEUTRAL', 'PULLBACK', '15m'],
  [A_MFF, 'MNQ', PV_MNQ, 18, 14, 0, 'LONG', 'NEW_YORK', 21905, 24, 10, 'CONFIDENT', 'BREAKOUT', '15m'],
  [A_MFF, 'MNQ', PV_MNQ, 19, 14, 20, 'LONG', 'NEW_YORK', 21960, 16, 10, 'FOCUSED', 'PULLBACK', '5m'],
];

// Forex (FTMO) : [accId, asset, day,h,m, side, session, entry, pips, lots, emo, setup, tf]
// EUR/USD & GBP/USD : 1 lot = 10 $/pip ; commission ~3,5 $/lot (A-R).
const forex = [
  // FTMO 100K — éval en cours, ~+4 800 (48% de l'objectif 10 000) ──
  [A_FTMO, 'EUR/USD', 2, 9, 30, 'LONG', 'LONDON', 1.0820, 32, 4, 'FOCUSED', 'BREAKOUT', '15m'],
  [A_FTMO, 'EUR/USD', 4, 13, 30, 'LONG', 'NEW_YORK', 1.0865, -18, 4, 'NEUTRAL', 'PULLBACK', '5m'],
  [A_FTMO, 'GBP/USD', 5, 9, 0, 'SHORT', 'LONDON', 1.2740, 40, 3, 'FOCUSED', 'REVERSAL', '15m'],
  [A_FTMO, 'EUR/USD', 9, 14, 0, 'LONG', 'NEW_YORK', 1.0905, 28, 4, 'CONFIDENT', 'BREAKOUT', '15m'],
  [A_FTMO, 'GBP/USD', 10, 8, 30, 'LONG', 'LONDON', 1.2690, -20, 3, 'STRESSED', 'PULLBACK', '5m'],
  [A_FTMO, 'EUR/USD', 11, 13, 45, 'SHORT', 'NEW_YORK', 1.0950, 30, 4, 'FOCUSED', 'REVERSAL', '15m'],
  [A_FTMO, 'GBP/USD', 12, 9, 15, 'LONG', 'LONDON', 1.2705, 44, 3, 'CONFIDENT', 'BREAKOUT', '15m'],
  [A_FTMO, 'EUR/USD', 16, 14, 0, 'LONG', 'NEW_YORK', 1.0980, -16, 4, 'NEUTRAL', 'RANGE', '5m'],
  [A_FTMO, 'GBP/USD', 18, 9, 30, 'LONG', 'LONDON', 1.2760, 36, 3, 'FOCUSED', 'PULLBACK', '15m'],
];

const rows = [];
for (const [accId, asset, pv, day, h, m, side, session, entry, pts, qty, emo, setup, tf] of futures) {
  const exit = r2(side === 'LONG' ? entry + pts : entry - pts);
  const slDist = 24, tpDist = 44;
  const stopLoss = r2(side === 'LONG' ? entry - slDist : entry + slDist);
  const takeProfit = r2(side === 'LONG' ? entry + tpDist : entry - tpDist);
  const commission = r2(qty * 0.94);
  const pnl = r2(pts * pv * qty - commission);
  const riskReward = r2(tpDist / slDist);
  const capitalEngaged = r2(qty * 120);
  rows.push([accId, cid(), asset, side, entry, exit, stopLoss, takeProfit, pnl, commission,
    riskReward, qty, capitalEngaged, emo, setup, session, tf, NOTES[setup], TAGS[setup], D(day, h, m)]);
}
for (const [accId, asset, day, h, m, side, session, entry, pips, lots, emo, setup, tf] of forex) {
  const exit = r2(side === 'LONG' ? entry + pips * 0.0001 : entry - pips * 0.0001);
  const stopLoss = r2(side === 'LONG' ? entry - 0.0025 : entry + 0.0025);
  const takeProfit = r2(side === 'LONG' ? entry + 0.0050 : entry - 0.0050);
  const commission = r2(lots * 3.5);
  const pnl = r2(pips * 10 * lots - commission);
  const riskReward = 2;
  const capitalEngaged = r2(lots * 1000);
  rows.push([accId, cid(), asset, side, entry, exit, stopLoss, takeProfit, pnl, commission,
    riskReward, lots, capitalEngaged, emo, setup, session, tf, NOTES[setup], TAGS[setup], D(day, h, m)]);
}

// ── Récap (stderr) ───────────────────────────────────────────────────────────
for (const a of ACCOUNTS) {
  const tr = rows.filter((r) => r[0] === a.id);
  const pnl = r2(tr.reduce((s, r) => s + r[8], 0));
  const pct = Math.round((pnl / a.target) * 100);
  process.stderr.write(
    `${a.label.padEnd(28)} ${String(tr.length).padStart(2)} trades  P&L ${String(pnl).padStart(9)}$  ` +
    `solde ${r2(a.start + pnl)}  →  ${pct}% de l'objectif (${a.target}$) [${a.status}]\n`,
  );
}

// ── SQL (stdout) ─────────────────────────────────────────────────────────────
const out = [];
out.push(`DELETE FROM "TradingAccount" WHERE id = '${LUCIDE_ID}';`);
const accVals = ACCOUNTS.map((a) =>
  `('${a.id}','${USER_ID}',${sq(a.label)},${sq(a.broker)},'${a.type}','${a.status}',${a.size},'USD',${a.start},${a.target},${a.maxDD},'${a.dd}',now(),now())`,
).join(',\n');
out.push(`INSERT INTO "TradingAccount" (id,"userId",label,broker,type,status,"accountSize",currency,"startingBalance","profitTarget","maxDrawdown","drawdownType","createdAt","updatedAt") VALUES\n${accVals};`);
const tradeVals = rows.map((r) =>
  `(${sq(r[1])},'${USER_ID}',${sq(r[2])},'${r[3]}',${r[4]},${r[5]},${r[6]},${r[7]},${r[8]},${r[9]},${r[10]},${r[11]},${r[12]},'${r[13]}','${r[14]}','${r[15]}',${sq(r[16])},${sq(r[17])},${arr(r[18])},${sq(r[0])},${sq(r[19])},${sq(r[19])})`,
).join(',\n');
out.push(`INSERT INTO "Trade" (id,"userId",asset,side,entry,exit,"stopLoss","takeProfit",pnl,commission,"riskReward",quantity,"capitalEngaged",emotion,setup,session,timeframe,notes,tags,"accountId","tradedAt","createdAt") VALUES\n${tradeVals};`);
console.log(out.join('\n'));
