/**
 * Rejeu silencieux des détecteurs de comportement sur l'historique (#602). LECTURE SEULE : le
 * script ne lit que des fichiers, il n'ouvre aucune connexion à la base et n'écrit rien.
 *
 * 1. Export pseudonymisé, avec le rôle en lecture seule (empreintes md5 tronquées, ni e-mail ni nom) :
 *    trades.jsonl   : {u, a, id, asset, side, entry, quantity, pnl, commission, tradedAt}
 *                     des utilisateurs ≥ 10 séances (compte × journée CME), hors démo ;
 *    accounts.jsonl : {a, u, type, accountSize, startingBalance, planSize, phases} ;
 *    users.jsonl    : {u, tradesPerDayMax, style}.
 *    (requêtes : `docs/rapport-detecteurs-silencieux.md`, annexe). Fichiers HORS du dépôt.
 * 2. pnpm exec tsx --tsconfig tools/scripts/tsconfig.check.json \
 *      apps/api-mytradingcoach/scripts/replay-behavior-alerts.ts <dossier des 3 fichiers> > rapport.md
 *
 * La sortie est déjà pseudonymisée (Trader A, B… par volume décroissant) : ni identifiant, ni
 * export brut de trades, seulement des agrégats et quelques exemples en contexte.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PropFirmPhaseRules } from '@mtc/shared';
import type { BehaviorAlertType } from '../src/modules/behavior/behavior-detectors';
import { phaseForAccountType } from '../src/modules/behavior/behavior-plan';
import type { BehaviorTrade } from '../src/modules/behavior/behavior-positions';
import { quantile } from '../src/modules/behavior/behavior-baseline';
import { LEARNING_MIN_SESSIONS } from '../src/modules/behavior/behavior.constants';
import { type ReplayAccount, type ReplaySession, replay } from '../src/modules/behavior/behavior-replay';

interface RawTrade { u: string; a: string; id: string; asset: string; side: string; entry: number; quantity: number | null; pnl: number; commission: number | null; tradedAt: string }
interface RawAccount { a: string; u: string; type: string; accountSize: number | null; startingBalance: number | null; planSize: number | null; phases: PropFirmPhaseRules[] | null }
interface RawUser { u: string; tradesPerDayMax: number | null; style: string | null }

const TYPES: BehaviorAlertType[] = [
  'A1_SIZE_OVER_PLAN', 'A2_DAILY_LOSS_DISTANCE', 'A3_ENTRY_DAY_STARTED',
  'B_REVENGE', 'C1_LOSS_STREAK', 'C2_OVER_DAILY_LIMIT', 'C3_MARTINGALE',
];
const EXAMPLES_PER_TYPE = 5;
/** Pires journées d'un trader : décile bas du plus bas intrajournalier (repli sans perte max du plan). */
const WORST_DAYS_QUANTILE = 0.1;

const readJsonl = <T>(path: string): T[] =>
  readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as T);

const money = (x: number) => `${x < 0 ? '−' : '+'}${Math.abs(x).toFixed(0)} $`;
const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d).replace('.', ',') : 'n/a');
const paris = (d: Date) =>
  d.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);

function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('Usage : replay-behavior-alerts <dossier contenant trades.jsonl, accounts.jsonl, users.jsonl>');
  const trades = readJsonl<RawTrade>(join(dir, 'trades.jsonl'));
  const accounts = readJsonl<RawAccount>(join(dir, 'accounts.jsonl'));
  const users = new Map(readJsonl<RawUser>(join(dir, 'users.jsonl')).map((u) => [u.u, u]));

  const byUser = new Map<string, RawTrade[]>();
  for (const t of trades) byUser.set(t.u, [...(byUser.get(t.u) ?? []), t]);
  const ordered = [...byUser.entries()].sort((a, b) => b[1].length - a[1].length);

  const out: string[] = [];
  const all: { label: string; sessions: ReplaySession[] }[] = [];
  ordered.forEach(([u, rows], i) => {
    const label = `Trader ${String.fromCharCode(65 + i)}`;
    const accs = new Map<string, ReplayAccount>();
    // Comptes pseudonymisés à leur tour : Compte 1, 2… dans l'ordre d'apparition.
    for (const a of accounts.filter((x) => x.u === u)) {
      const phase = a.phases ? phaseForAccountType(a.phases, a.type) : null;
      accs.set(a.a, {
        startingBalance: a.startingBalance ?? a.accountSize ?? phase?.starting_balance ?? a.planSize ?? 0,
        phase,
      });
    }
    const input: BehaviorTrade[] = rows.map((r) => ({
      id: r.id, accountId: r.a, asset: r.asset, side: r.side === 'SHORT' ? 'SHORT' : 'LONG',
      entry: r.entry, quantity: r.quantity, pnl: r.pnl, commission: r.commission, tradedAt: new Date(r.tradedAt),
    }));
    const sessions = replay({ trades: input, accounts: accs, tradesPerDayMax: users.get(u)?.tradesPerDayMax ?? null });
    all.push({ label, sessions });
  });

  out.push('<!-- Généré par apps/api-mytradingcoach/scripts/replay-behavior-alerts.ts : ne pas éditer à la main. -->');
  out.push('');
  out.push('## Périmètre');
  out.push('');
  out.push('| Trader | Lignes | Positions | Séances | Séances avec référence fiable (≥ 10) | Comptes reliés à un plan | Limite déclarée / jour | Style |');
  out.push('|---|---|---|---|---|---|---|---|');
  ordered.forEach(([u, rows], i) => {
    const { label, sessions } = all[i];
    const positions = sessions.reduce((s, x) => s + x.positions.length, 0);
    const reliable = sessions.filter((s) => s.baseline.sessionsUsed >= LEARNING_MIN_SESSIONS).length;
    const planned = accounts.filter((a) => a.u === u && a.phases).length;
    const usr = users.get(u);
    out.push(`| ${label} | ${rows.length} | ${positions} | ${sessions.length} | ${reliable} | ${planned} | ${usr?.tradesPerDayMax ?? '-'} | ${usr?.style ?? '-'} |`);
  });

  // 1. Alertes par séance, par trader et par détecteur.
  out.push('');
  out.push('## 1. Alertes par séance');
  out.push('');
  out.push('Moyenne / p90 / max d’alertes par séance (toutes séances, y compris la période d’apprentissage).');
  out.push('');
  out.push(`| Trader | Toutes | ${TYPES.join(' | ')} |`);
  out.push(`|---|---|${TYPES.map(() => '---').join('|')}|`);
  for (const { label, sessions } of all) {
    const cell = (f: (s: ReplaySession) => number) => {
      const xs = sessions.map(f);
      return xs.length ? `${num(mean(xs))} / ${num(quantile(xs, 0.9), 1)} / ${Math.max(...xs)}` : '-';
    };
    out.push(`| ${label} | ${cell((s) => s.alerts.length)} | ${TYPES.map((t) => cell((s) => s.alerts.filter((a) => a.type === t).length)).join(' | ')} |`);
  }
  out.push('');
  out.push('Sur les seules séances à référence fiable (B, C1, C3 actifs) :');
  out.push('');
  out.push('| Trader | Séances | Toutes | B | C1 | C2 | C3 |');
  out.push('|---|---|---|---|---|---|---|');
  for (const { label, sessions } of all) {
    const rel = sessions.filter((s) => s.baseline.sessionsUsed >= LEARNING_MIN_SESSIONS);
    const m = (f: (s: ReplaySession) => number) => (rel.length ? num(mean(rel.map(f))) : '-');
    const t = (type: BehaviorAlertType) => m((s) => s.alerts.filter((a) => a.type === type).length);
    out.push(`| ${label} | ${rel.length} | ${m((s) => s.alerts.length)} | ${t('B_REVENGE')} | ${t('C1_LOSS_STREAK')} | ${t('C2_OVER_DAILY_LIMIT')} | ${t('C3_MARTINGALE')} |`);
  }

  // 2. Exemples par détecteur.
  out.push('');
  out.push('## 2. Exemples (5 par détecteur)');
  out.push('');
  out.push('Contexte : 2 positions avant, la position alertée (→), 2 après. Heure de Paris, P&L net.');
  for (const type of TYPES) {
    const found = all.flatMap(({ label, sessions }) =>
      sessions.flatMap((s) => s.alerts.filter((a) => a.type === type).map((a) => ({ label, s, a }))),
    );
    out.push('');
    out.push(`### ${type} (${found.length} au total)`);
    if (found.length === 0) {
      out.push('');
      out.push('Aucune alerte.');
      continue;
    }
    // Étalées sur la période : un exemple tous les n/5.
    const step = Math.max(1, Math.floor(found.length / EXAMPLES_PER_TYPE));
    for (const { label, s, a } of found.filter((_, i) => i % step === 0).slice(0, EXAMPLES_PER_TYPE)) {
      out.push('');
      out.push(`- **${label}**, ${paris(a.at)} : « ${a.message} » (${a.severity})`);
      for (let i = Math.max(0, a.positionIndex - 2); i <= Math.min(s.positions.length - 1, a.positionIndex + 2); i++) {
        const p = s.positions[i];
        out.push(`  - ${i === a.positionIndex ? '→ ' : ''}${paris(p.closedAt).slice(-8)} ${p.asset} ${p.side} ×${p.quantity} : ${money(p.pnl)}`);
      }
      const rest = s.positions.slice(a.positionIndex).reduce((x, p) => x + p.pnl, 0);
      out.push(`  - suite de la séance à partir de l’alerte : ${money(rest)}`);
    }
  }

  // 3. Le chiffre qui compte.
  out.push('');
  out.push('## 3. Le chiffre qui compte');
  out.push('');
  out.push('P&L net moyen de la position prise sur l’alerte (l’entrée qui la déclenche) contre les autres positions.');
  out.push('');
  out.push('| Trader | Détecteur | Positions alertées | P&L moyen / médian alertées | Pire alertée | Autres positions | P&L moyen / médian autres | Pire autre | Part perdante alertées | Part perdante autres |');
  out.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const { label, sessions } of all) {
    for (const type of ['TOUTES', ...TYPES] as const) {
      const flagged: number[] = [];
      const others: number[] = [];
      for (const s of sessions) {
        const hit = new Set(s.alerts.filter((a) => type === 'TOUTES' || a.type === type).map((a) => a.positionIndex));
        s.positions.forEach((p, i) => (hit.has(i) ? flagged : others).push(p.pnl));
      }
      if (flagged.length === 0) continue;
      const lossShare = (xs: number[]) => `${Math.round((100 * xs.filter((x) => x < 0).length) / Math.max(1, xs.length))} %`;
      const med = (xs: number[]) => (xs.length ? money(quantile(xs, 0.5)) : '-');
      const worst = (xs: number[]) => (xs.length ? money(Math.min(...xs)) : '-');
      out.push(`| ${label} | ${type} | ${flagged.length} | ${money(mean(flagged))} / ${med(flagged)} | ${worst(flagged)} | ${others.length} | ${others.length ? money(mean(others)) : '-'} / ${med(others)} | ${worst(others)} | ${lossShare(flagged)} | ${lossShare(others)} |`);
    }
  }
  out.push('');
  out.push('Mauvaises journées précédées d’au moins une alerte (alerte AVANT le point bas de la journée) :');
  out.push('');
  out.push('Taux de base : part de TOUTES les séances du trader avec au moins une alerte.');
  out.push('');
  out.push('| Trader | Définition | Journées | Précédées d’une alerte | Journées sans alerte du tout | Taux de base |');
  out.push('|---|---|---|---|---|---|');
  for (const { label, sessions } of all) {
    const preceded = (s: ReplaySession) => s.alerts.some((a) => a.positionIndex <= s.lowIndex);
    const base = `${Math.round((100 * sessions.filter((s) => s.alerts.length > 0).length) / Math.max(1, sessions.length))} %`;
    const dll = sessions.filter((s) => s.dailyLossLimit != null && -s.low >= 0.8 * s.dailyLossLimit);
    const withDll = sessions.filter((s) => s.dailyLossLimit != null).length;
    out.push(`| ${label} | perte max du plan atteinte ou > 80 % (${withDll} séances avec règle) | ${dll.length} | ${dll.filter(preceded).length} | ${dll.filter((s) => s.alerts.length === 0).length} | ${base} |`);
    const lows = sessions.map((s) => s.low).filter((x) => x < 0);
    if (lows.length > 0) {
      const cut = quantile(lows, WORST_DAYS_QUANTILE);
      const worst = sessions.filter((s) => s.low <= cut);
      out.push(`| ${label} | 10 % de séances au plus bas intrajournalier le plus profond (≤ ${money(cut)}) | ${worst.length} | ${worst.filter(preceded).length} | ${worst.filter((s) => s.alerts.length === 0).length} | ${base} |`);
    }
  }

  // 4. Faux positifs probables de B.
  out.push('');
  out.push('## 4. Faux positifs probables (B)');
  out.push('');
  out.push('Alertes B dont la position alertée ET la suite de la séance finissent gagnantes.');
  out.push('');
  let fp = 0;
  let totalB = 0;
  for (const { label, sessions } of all) {
    for (const s of sessions) {
      for (const a of s.alerts.filter((x) => x.type === 'B_REVENGE')) {
        totalB++;
        const p = s.positions[a.positionIndex];
        const rest = s.positions.slice(a.positionIndex).reduce((x, q) => x + q.pnl, 0);
        if (p.pnl > 0 && rest > 0) {
          fp++;
          const signals = (a.context['signals'] as string[]).join(' + ');
          out.push(`- ${label}, ${paris(a.at)} : ${signals} ; position ${money(p.pnl)}, suite ${money(rest)}`);
        }
      }
    }
  }
  out.push('');
  out.push(`**${fp} sur ${totalB}** alertes B (${totalB ? Math.round((100 * fp) / totalB) : 0} %).`);

  // 5. Variante plus stricte, rejouée par filtrage des alertes (le contexte porte les quantiles).
  out.push('');
  out.push('## 5. Variante proposée (rejouée)');
  out.push('');
  out.push('- **B** : le signal « taille » exige `taille > max(p90, 2 × médiane)` au lieu de `> p75`.');
  out.push('- **C3** : la taille doublée doit AUSSI dépasser le p90 du trader sur l’actif.');
  out.push('');
  out.push('| Trader | Alertes / séance (actuel → variante) | B (actuel → variante) | C3 (actuel → variante) | P&L moyen alertées (variante) | Part perdante alertées (variante) | B gagnantes jusqu’au bout (variante) |');
  out.push('|---|---|---|---|---|---|---|');
  for (const { label, sessions } of all) {
    const keep = (a: ReplaySession['alerts'][number]) => {
      const c = a.context as Record<string, unknown>;
      if (a.type === 'B_REVENGE') {
        const signals = (c['signals'] as string[]).filter((sg) => {
          if (sg !== 'size_above_p75') return true;
          const q = c['quantity'] as number;
          const p90 = (c['sizeP90'] as number | null) ?? Infinity;
          const med = (c['sizeMedian'] as number | null) ?? Infinity;
          return q > Math.max(p90, 2 * med);
        });
        return signals.length >= 2;
      }
      if (a.type === 'C3_MARTINGALE') return (c['quantity'] as number) > ((c['sizeP90'] as number | null) ?? Infinity);
      return true;
    };
    const kept = sessions.map((s) => ({ s, alerts: s.alerts.filter(keep) }));
    const count = (xs: { alerts: ReplaySession['alerts'] }[], t?: BehaviorAlertType) =>
      xs.reduce((n, x) => n + x.alerts.filter((a) => !t || a.type === t).length, 0);
    const before = sessions.map((s) => ({ alerts: s.alerts }));
    const pnl: number[] = [];
    let bWin = 0;
    for (const { s, alerts } of kept) {
      const idx = new Set(alerts.map((a) => a.positionIndex));
      for (const i of idx) pnl.push(s.positions[i].pnl);
      for (const a of alerts.filter((x) => x.type === 'B_REVENGE')) {
        const rest = s.positions.slice(a.positionIndex).reduce((x, q) => x + q.pnl, 0);
        if (s.positions[a.positionIndex].pnl > 0 && rest > 0) bWin++;
      }
    }
    const n = sessions.length || 1;
    out.push(
      `| ${label} | ${num(count(before) / n)} → ${num(count(kept) / n)} | ${count(before, 'B_REVENGE')} → ${count(kept, 'B_REVENGE')} | ` +
        `${count(before, 'C3_MARTINGALE')} → ${count(kept, 'C3_MARTINGALE')} | ${pnl.length ? money(mean(pnl)) : '-'} | ` +
        `${pnl.length ? Math.round((100 * pnl.filter((x) => x < 0).length) / pnl.length) : 0} % | ${bWin} / ${count(kept, 'B_REVENGE')} |`,
    );
  }

  process.stdout.write(out.join('\n') + '\n');
}

main();
