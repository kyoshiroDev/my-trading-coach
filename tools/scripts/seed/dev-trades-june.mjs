// Génère des trades réalistes MNQ (+ MNT/USDT) du 01 au 15 juin 2026 (lun-ven)
// pour un compte de dev (userId en argument). Sort du SQL sur stdout.
import { randomUUID } from 'node:crypto';

// Utilisateur cible : premier argument (id en base), jamais un compte en dur dans le dépôt.
const USER_ID = process.argv[2];
if (!USER_ID) {
  console.error('Usage : node tools/scripts/seed/dev-trades-june.mjs <userId> > seed.sql');
  process.exit(1);
}
const PV = 2; // MNQ : 2 $/point/contrat
const cid = () => 'c' + randomUUID().replace(/-/g, '').slice(0, 24);

// points = P&L signé en points (positif = gagnant). Pour SHORT, exit = entry - points.
// MNQ : pnl_gross = points * 2 * qty. commission ~ 0.94 $/contrat (aller-retour).
const D = (day, hUTC, m) =>
  new Date(Date.UTC(2026, 5, day, hUTC, m, 0)).toISOString();

const NOTES = {
  BREAKOUT: "Cassure du range d'ouverture sur volume",
  PULLBACK: 'Repli sur la MM20 en tendance haussiere',
  REVERSAL: 'Divergence RSI + rejet sur resistance',
  RANGE: 'Rejet sur la borne du range',
  SCALPING: 'Scalp rapide sur impulsion',
  NEWS: 'Reaction post-annonce eco',
};
const TAGS = {
  BREAKOUT: ['breakout', 'momentum'],
  PULLBACK: ['pullback', 'trend'],
  REVERSAL: ['reversal', 'contre-tendance'],
  RANGE: ['range', 'mean-reversion'],
  SCALPING: ['scalp'],
  NEWS: ['news'],
};

// Chaque trade MNQ : [day,h,m,side,session,entry,points,qty,emotion,setup,tf,noteOverride?]
const mnq = [
  // Jun 1 (lun)
  [1, 13, 45, 'LONG', 'NEW_YORK', 21318, 28, 2, 'FOCUSED', 'BREAKOUT', '5m'],
  [1, 14, 20, 'LONG', 'NEW_YORK', 21345, -16, 2, 'NEUTRAL', 'PULLBACK', '5m'],
  [1, 15, 10, 'LONG', 'NEW_YORK', 21360, 22, 1, 'CONFIDENT', 'BREAKOUT', '15m'],
  // Jun 2 (mar)
  [2, 8, 15, 'SHORT', 'LONDON', 21395, 24, 2, 'FOCUSED', 'REVERSAL', '5m'],
  [2, 14, 5, 'LONG', 'NEW_YORK', 21372, -16, 2, 'NEUTRAL', 'PULLBACK', '5m'],
  // Jun 3 (mer) — mauvaise journee, choppy
  [3, 13, 50, 'LONG', 'NEW_YORK', 21305, -22, 2, 'NEUTRAL', 'BREAKOUT', '5m'],
  [3, 14, 30, 'SHORT', 'NEW_YORK', 21288, -14, 1, 'STRESSED', 'RANGE', '5m'],
  [3, 15, 5, 'LONG', 'NEW_YORK', 21295, -18, 2, 'REVENGE', 'BREAKOUT', '1m', 'Trade de revanche apres 2 pertes — a eviter'],
  // Jun 4 (jeu)
  [4, 8, 40, 'LONG', 'LONDON', 21440, 30, 2, 'FOCUSED', 'PULLBACK', '15m'],
  [4, 14, 15, 'LONG', 'NEW_YORK', 21470, 20, 2, 'CONFIDENT', 'BREAKOUT', '5m'],
  // Jun 5 (ven)
  [5, 8, 30, 'SHORT', 'LONDON', 21530, -10, 1, 'NEUTRAL', 'REVERSAL', '5m'],
  [5, 14, 0, 'LONG', 'NEW_YORK', 21515, 34, 3, 'CONFIDENT', 'BREAKOUT', '15m'],
  [5, 15, 20, 'LONG', 'NEW_YORK', 21548, -12, 2, 'NEUTRAL', 'PULLBACK', '5m'],
  // Jun 8 (lun)
  [8, 13, 55, 'LONG', 'NEW_YORK', 21475, 26, 2, 'FOCUSED', 'BREAKOUT', '5m'],
  [8, 15, 0, 'SHORT', 'NEW_YORK', 21500, -16, 2, 'NEUTRAL', 'RANGE', '5m'],
  // Jun 9 (mar)
  [9, 8, 20, 'LONG', 'LONDON', 21590, -14, 2, 'CONFIDENT', 'PULLBACK', '5m'],
  [9, 14, 10, 'LONG', 'NEW_YORK', 21615, 30, 2, 'FOCUSED', 'BREAKOUT', '15m'],
  // Jun 10 (mer)
  [10, 13, 50, 'LONG', 'NEW_YORK', 21640, -16, 2, 'NEUTRAL', 'PULLBACK', '5m'],
  [10, 14, 40, 'SHORT', 'NEW_YORK', 21670, 20, 2, 'FOCUSED', 'REVERSAL', '5m'],
  // Jun 11 (jeu) — pullback marche
  [11, 8, 25, 'SHORT', 'LONDON', 21590, 24, 2, 'FOCUSED', 'REVERSAL', '15m'],
  [11, 14, 0, 'LONG', 'NEW_YORK', 21560, -20, 2, 'FEAR', 'BREAKOUT', '5m'],
  [11, 15, 15, 'LONG', 'NEW_YORK', 21548, 16, 1, 'NEUTRAL', 'PULLBACK', '5m'],
  // Jun 12 (ven)
  [12, 14, 5, 'LONG', 'NEW_YORK', 21710, 28, 2, 'CONFIDENT', 'BREAKOUT', '15m'],
  [12, 15, 0, 'LONG', 'NEW_YORK', 21740, -12, 2, 'NEUTRAL', 'PULLBACK', '5m'],
  // Jun 15 (lun)
  [15, 8, 35, 'LONG', 'LONDON', 21840, 20, 2, 'FOCUSED', 'BREAKOUT', '5m'],
  [15, 14, 0, 'SHORT', 'NEW_YORK', 21870, -14, 2, 'NEUTRAL', 'RANGE', '5m'],
  [15, 15, 10, 'LONG', 'NEW_YORK', 21855, 32, 2, 'CONFIDENT', 'PULLBACK', '15m'],
];

// Trades crypto MNT/USDT : [day,h,m,side,entry,exit,qty,emotion,setup,tf]
const crypto = [
  [9, 3, 0, 'LONG', 0.842, 0.861, 1500, 'FOCUSED', 'BREAKOUT', '1h'],
  [12, 4, 30, 'SHORT', 0.87, 0.858, 1200, 'NEUTRAL', 'REVERSAL', '1h'],
];

const rows = [];
const sq = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
const arr = (a) => `'{${a.map((x) => `"${x}"`).join(',')}}'`;
const r2 = (n) => Math.round(n * 100) / 100;

for (const [day, h, m, side, session, entry, pts, qty, emotion, setup, tf, noteOv] of mnq) {
  const exit = r2(side === 'LONG' ? entry + pts : entry - pts);
  const slDist = 22, tpDist = 44;
  const stopLoss = r2(side === 'LONG' ? entry - slDist : entry + slDist);
  const takeProfit = r2(side === 'LONG' ? entry + tpDist : entry - tpDist);
  const commission = r2(qty * 0.94);
  const pnl = r2(pts * PV * qty - commission);
  const riskReward = r2(tpDist / slDist);
  const capitalEngaged = r2(qty * 100); // marge intraday ~100$/contrat
  const ts = D(day, h, m);
  rows.push([
    cid(), 'MNQ', side, entry, exit, stopLoss, takeProfit, pnl, commission,
    riskReward, qty, capitalEngaged, emotion, setup, session, tf,
    noteOv || NOTES[setup], TAGS[setup], ts,
  ]);
}

for (const [day, h, m, side, entry, exit, qty, emotion, setup, tf] of crypto) {
  const gross = (side === 'LONG' ? exit - entry : entry - exit) * qty;
  const commission = r2(entry * qty * 0.001);
  const pnl = r2(gross - commission);
  const slDist = 0.02, tpDist = 0.035;
  const stopLoss = r2(side === 'LONG' ? entry - slDist : entry + slDist);
  const takeProfit = r2(side === 'LONG' ? entry + tpDist : entry - tpDist);
  const riskReward = r2(tpDist / slDist);
  const capitalEngaged = r2(entry * qty);
  rows.push([
    cid(), 'MNT/USDT', side, entry, exit, stopLoss, takeProfit, pnl, commission,
    riskReward, qty, capitalEngaged, emotion, setup, 'ASIAN', tf,
    'Setup altcoin MNT sur USDT', ['crypto', setup.toLowerCase()], D(day, h, m),
  ]);
}

const values = rows
  .map(
    (r) =>
      `(${sq(r[0])}, '${USER_ID}', ${sq(r[1])}, '${r[2]}', ${r[3]}, ${r[4]}, ${r[5]}, ${r[6]}, ${r[7]}, ${r[8]}, ${r[9]}, ${r[10]}, ${r[11]}, '${r[12]}', '${r[13]}', '${r[14]}', ${sq(r[15])}, ${sq(r[16])}, ${arr(r[17])}, ${sq(r[18])}, ${sq(r[18])})`,
  )
  .join(',\n');

console.log(`INSERT INTO "Trade" (id, "userId", asset, side, entry, exit, "stopLoss", "takeProfit", pnl, commission, "riskReward", quantity, "capitalEngaged", emotion, setup, session, timeframe, notes, tags, "tradedAt", "createdAt") VALUES\n${values};`);
