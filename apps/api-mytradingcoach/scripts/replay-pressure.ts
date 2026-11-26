/**
 * Étude de la jauge de pression (#1270, étape 1). LECTURE SEULE : aucune connexion à la base,
 * aucune écriture. Rejoue la jauge (`behavior-pressure.ts`) sur un historique et mesure son pouvoir
 * prédictif (`behavior-pressure-eval.ts`).
 *
 * Deux sources :
 * - `--demo` : jeu du compte démo, généré en mémoire (`buildDemoDataset`, date figée). Synthétique :
 *   il vérifie la mécanique, il ne prouve RIEN sur le pouvoir prédictif.
 * - `<dossier>` : export pseudonymisé au format du rejeu #602 (`trades.jsonl`, `users.jsonl`, voir
 *   `scripts/replay-behavior-alerts.ts`). Un export prod ne se fait qu'avec l'accord de Greg.
 *
 *   pnpm exec tsx --tsconfig tools/scripts/tsconfig.check.json \
 *     apps/api-mytradingcoach/scripts/replay-pressure.ts --demo > rapport.md
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDemoDataset } from '../src/modules/admin/demo-data/generate';
import type { BehaviorTrade } from '../src/modules/behavior/behavior-positions';
import type { PressureLevel, PressureSignal } from '../src/modules/behavior/behavior-pressure';
import { evaluatePressure } from '../src/modules/behavior/behavior-pressure-eval';
import { type ReplaySession, replay } from '../src/modules/behavior/behavior-replay';

interface Group { label: string; trades: BehaviorTrade[]; tradesPerDayMax: number | null; kindByDay?: Map<string, string> }

const LEVELS: PressureLevel[] = ['learning', 'calm', 'watch', 'red'];
const LABEL: Record<PressureLevel, string> = { learning: 'Apprentissage', calm: 'Calme', watch: 'Vigilance', red: 'Zone rouge' };
const SIGNALS: PressureSignal[] = ['fast_reentry', 'size_up', 'pace', 'loss_streak', 'daily_loss_used', 'over_plan', 'over_limit'];
/** Date figée du jeu démo : le rapport est reproductible. */
const DEMO_NOW = new Date('2026-11-26T20:00:00Z');

const money = (x: number) => `${x < 0 ? '−' : '+'}${Math.abs(x).toFixed(0)} $`;
const pct = (x: number) => `${Math.round(x * 100)} %`;
const readJsonl = <T>(path: string): T[] => readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as T);

function demoGroups(): Group[] {
  const { days } = buildDemoDataset(DEMO_NOW);
  let id = 0;
  const trades: BehaviorTrade[] = [];
  const kindByDay = new Map<string, string>();
  for (const d of days) {
    for (const t of d.trades) {
      trades.push({ id: String(++id), accountId: t.account, asset: t.asset, side: t.side, entry: t.entry, quantity: t.quantity, pnl: t.pnl, commission: t.commission, tradedAt: t.tradedAt });
    }
    if (d.trades[0]) kindByDay.set(`${d.account}:${d.trades[0].tradedAt.toISOString().slice(0, 10)}`, d.kind);
  }
  return [{ label: 'Démo', trades, tradesPerDayMax: null, kindByDay }];
}

function exportGroups(dir: string): Group[] {
  type Raw = { u: string; a: string; id: string; asset: string; side: string; entry: number; quantity: number | null; pnl: number; commission: number | null; tradedAt: string };
  const users = new Map(readJsonl<{ u: string; tradesPerDayMax: number | null }>(join(dir, 'users.jsonl')).map((u) => [u.u, u]));
  const byUser = new Map<string, Raw[]>();
  for (const t of readJsonl<Raw>(join(dir, 'trades.jsonl'))) byUser.set(t.u, [...(byUser.get(t.u) ?? []), t]);
  return [...byUser.entries()].sort((a, b) => b[1].length - a[1].length).map(([u, rows], i) => ({
    label: `Trader ${String.fromCharCode(65 + i)}`,
    tradesPerDayMax: users.get(u)?.tradesPerDayMax ?? null,
    trades: rows.map((r) => ({ id: r.id, accountId: r.a, asset: r.asset, side: r.side === 'SHORT' ? 'SHORT' : 'LONG', entry: r.entry, quantity: r.quantity, pnl: r.pnl, commission: r.commission, tradedAt: new Date(r.tradedAt) })),
  }));
}

function main() {
  const arg = process.argv[2];
  if (!arg) throw new Error('Usage : replay-pressure --demo | <dossier contenant trades.jsonl et users.jsonl>');
  const groups = arg === '--demo' ? demoGroups() : exportGroups(arg);
  const out: string[] = ['<!-- Généré par apps/api-mytradingcoach/scripts/replay-pressure.ts : ne pas éditer à la main. -->', ''];

  for (const g of groups) {
    // Sans plan relié (accounts vide) : over_plan et perte max du jour muets, comme sur la démo.
    const sessions: ReplaySession[] = replay({ trades: g.trades, accounts: new Map(), tradesPerDayMax: g.tradesPerDayMax });
    const e = evaluatePressure(sessions);
    const positions = sessions.reduce((s, x) => s + x.positions.length, 0);
    out.push(`## ${g.label}`, '');
    out.push(`${g.trades.length} lignes, ${positions} positions, ${e.sessions} séances dont ${e.scoredSessions} hors apprentissage.`, '');
    out.push('### Par état à l’entrée', '');
    out.push('| État | Positions | P&L moyen | P&L médian | Perdantes | Pire position | Suite de la séance (moyenne) |');
    out.push('|---|---|---|---|---|---|---|');
    for (const l of LEVELS) {
      const s = e.byLevel[l];
      out.push(`| ${LABEL[l]} | ${s.positions} | ${money(s.meanPnl)} | ${money(s.medianPnl)} | ${pct(s.lossRate)} | ${money(s.worstPnl)} | ${money(s.meanRestOfSession)} |`);
    }
    out.push('', '### Par séance', '');
    out.push(`- Séances qui atteignent la zone rouge : ${pct(e.redSessionRate)} des séances notées (taux de base).`);
    out.push(`- Pires journées (décile bas du plus bas intrajournalier) : ${e.worstDays} ; en zone rouge : ${e.worstDaysRed} ; zone rouge au plus tard à leur plus bas : ${e.worstDaysRedBeforeLow}.`);

    const counts = new Map<PressureSignal, number>();
    for (const s of sessions) for (const r of s.pressure) for (const c of r.contributions) counts.set(c.signal, (counts.get(c.signal) ?? 0) + 1);
    out.push('', '### Signaux (nombre d’entrées où le signal compte)', '');
    out.push(`| ${SIGNALS.join(' | ')} |`, `|${SIGNALS.map(() => '---').join('|')}|`, `| ${SIGNALS.map((s) => counts.get(s) ?? 0).join(' | ')} |`);

    if (g.kindByDay) {
      const byKind = new Map<string, { n: number; red: number }>();
      for (const s of sessions) {
        if (!s.pressure.some((r) => r.level !== 'learning')) continue;
        const kind = g.kindByDay.get(`${s.accountId}:${s.positions[0]?.closedAt.toISOString().slice(0, 10)}`) ?? 'inconnu';
        const k = byKind.get(kind) ?? { n: 0, red: 0 };
        k.n++;
        if (s.pressure.some((r) => r.level === 'red')) k.red++;
        byKind.set(kind, k);
      }
      out.push('', '### Démo : zone rouge par type de journée générée', '', '| Type | Séances notées | En zone rouge |', '|---|---|---|');
      for (const [kind, k] of [...byKind.entries()].sort()) out.push(`| ${kind} | ${k.n} | ${k.red} |`);
    }

    const reds = sessions.flatMap((s) => s.pressure.map((r, i) => ({ s, r, i })).filter((x) => x.r.level === 'red'));
    out.push('', `### Exemples de zone rouge (${Math.min(5, reds.length)} sur ${reds.length})`, '');
    const step = Math.max(1, Math.floor(reds.length / 5));
    for (const { s, r, i } of reds.filter((_, k) => k % step === 0).slice(0, 5)) {
      const rest = s.positions.slice(i).reduce((sum, p) => sum + p.pnl, 0);
      out.push(`- ${s.day}, position ${i + 1}/${s.positions.length}, score ${r.score} : ${r.message} Position ${money(s.positions[i].pnl)}, suite de la séance ${money(rest)}.`);
    }
    out.push('');
  }
  process.stdout.write(out.join('\n') + '\n');
}

main();
