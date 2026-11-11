import { netPnl, roundCents, type TradeStatInput } from './trade-stats';

/**
 * Drawdown max : SOURCE UNIQUE front + back (fix/drawdown-max-par-trade).
 *
 * Règle : plus grand écart entre un sommet et le creux qui le suit, sur le solde cumulé APRÈS
 * CHAQUE TRADE CLÔTURÉ (ordre chronologique de clôture, P&L NET des frais), sur la période choisie.
 * Le solde du début de la période compte comme premier sommet : une période qui commence par une
 * perte part donc en drawdown.
 *
 * Ce que ce calcul NE voit PAS : les variations en cours de trade (MTC ne connaît que le résultat
 * à la clôture). Un trade ouvert (pnl absent) est hors calcul.
 *
 * Trades du même instant : MTC n'a aucun moyen de savoir lequel s'est fermé en premier. Ils
 * forment UNE seule étape (leur somme), pour ne pas inventer un creux qui dépendrait d'un ordre
 * arbitraire.
 *
 * Code PUR, sans dépendance : importable par Angular (esbuild) et NestJS (webpack).
 */

/** Résultat d'un drawdown max. Montants ≤ 0, arrondis au centime. */
export interface MaxDrawdown {
  /** Plus fort drawdown (≤ 0) ; 0 sans baisse ou sans trade. */
  maxDrawdown: number;
  /** Drawdown après chaque étape (≤ 0), point de départ (0) compris : `steps + 1` valeurs. */
  series: number[];
  /** Indice dans `series` du sommet d'où part le drawdown max ; null sans baisse. */
  peakIndex: number | null;
  /** Indice dans `series` du creux du drawdown max ; null sans baisse. */
  troughIndex: number | null;
}

/** Trade lu pour le drawdown : P&L brut + frais, et heure de clôture. */
export interface DrawdownTrade extends TradeStatInput {
  /** Heure de clôture (ISO ou Date). Dans MTC : `tradedAt`. */
  closedAt: string | Date;
}

/** Étape de la courbe : une clôture (ou plusieurs au même instant), P&L cumulé depuis le début. */
export interface ClosedTradeStep {
  /** Heure de clôture, ISO. */
  date: string;
  /** P&L net cumulé depuis le début de la période, arrondi au centime. */
  cumulativePnl: number;
  /** P&L net de l'étape (somme des trades du même instant). */
  pnl: number;
  /** Nombre de trades clôturés à cet instant. */
  trades: number;
}

const iso = (d: string | Date): string => (typeof d === 'string' ? new Date(d) : d).toISOString();

/**
 * Courbe du P&L net cumulé après chaque clôture : trades ouverts exclus, ordre chronologique,
 * trades du même instant regroupés en une étape.
 */
export function closedTradeSteps(trades: readonly DrawdownTrade[]): ClosedTradeStep[] {
  const closed = trades
    .map((t) => ({ net: netPnl(t), date: iso(t.closedAt) }))
    .filter((t): t is { net: number; date: string } => t.net !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const steps: ClosedTradeStep[] = [];
  let cum = 0;
  for (const t of closed) {
    cum = roundCents(cum + t.net);
    const last = steps[steps.length - 1];
    if (last && last.date === t.date) {
      last.pnl = roundCents(last.pnl + t.net);
      last.trades += 1;
      last.cumulativePnl = cum;
    } else {
      steps.push({ date: t.date, cumulativePnl: cum, pnl: t.net, trades: 1 });
    }
  }
  return steps;
}

/**
 * Drawdown max d'une courbe de P&L cumulé (une valeur par étape, départ implicite à 0).
 * À sommets égaux, le drawdown part du DERNIER sommet atteint (le creux qui suit est le même).
 */
export function maxDrawdownOfCumulative(cumulative: readonly number[]): MaxDrawdown {
  let peak = 0;
  let peakIdx = 0;
  let max = 0;
  let maxPeak: number | null = null;
  let maxTrough: number | null = null;
  const series = [0];
  cumulative.forEach((value, k) => {
    const i = k + 1;
    if (value >= peak) {
      peak = value;
      peakIdx = i;
    }
    const dd = roundCents(value - peak);
    series.push(dd);
    if (dd < max) {
      max = dd;
      maxPeak = peakIdx;
      maxTrough = i;
    }
  });
  return { maxDrawdown: max, series, peakIndex: maxPeak, troughIndex: maxTrough };
}

/** Drawdown max des trades clôturés d'une période (règle de ce fichier). */
export function maxDrawdownOfTrades(trades: readonly DrawdownTrade[]): MaxDrawdown {
  return maxDrawdownOfCumulative(closedTradeSteps(trades).map((s) => s.cumulativePnl));
}

/** Trade lu pour le drawdown par compte : `accountId` null = trade sans compte (groupe à part). */
export interface AccountDrawdownTrade extends DrawdownTrade {
  accountId: string | null;
}

/** Pire drawdown parmi les comptes d'une vue (« Tous les comptes »). */
export interface WorstAccountDrawdown {
  /** Plus fort drawdown (≤ 0) d'UN compte ; 0 sans baisse ou sans trade. */
  maxDrawdown: number;
  /**
   * Compte d'où vient ce drawdown ; null s'il vient des trades sans compte, ou s'il n'y a aucune
   * baisse (`maxDrawdown` = 0).
   */
  accountId: string | null;
}

/**
 * Drawdown max PAR COMPTE (PROMPT-drawdown-max-par-compte) : chaque compte a sa propre série
 * (règle de `maxDrawdownOfTrades`, trades du même instant regroupés À L'INTÉRIEUR du compte), et on
 * garde le pire. Jamais une série qui mélange plusieurs comptes : le gain d'un compte n'efface pas
 * la perte d'un autre, comme pour les règles des prop firms, qui s'appliquent compte par compte.
 * Les trades sans compte forment leur propre groupe. Égalité entre deux groupes : le plus petit
 * identifiant gagne (trades sans compte en premier), pour un résultat stable d'un appel à l'autre.
 * Vue d'un seul compte : même résultat que `maxDrawdownOfTrades`.
 */
export function worstAccountDrawdown(trades: readonly AccountDrawdownTrade[]): WorstAccountDrawdown {
  const byAccount = new Map<string | null, AccountDrawdownTrade[]>();
  for (const t of trades) {
    const group = byAccount.get(t.accountId);
    if (group) group.push(t);
    else byAccount.set(t.accountId, [t]);
  }
  // Ordre binaire (pas localeCompare) : identique quelle que soit la langue du processus.
  const key = (id: string | null) => id ?? '';
  const ordered = [...byAccount].sort(([a], [b]) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  let worst: WorstAccountDrawdown = { maxDrawdown: 0, accountId: null };
  for (const [accountId, group] of ordered) {
    const dd = maxDrawdownOfTrades(group).maxDrawdown;
    if (dd < worst.maxDrawdown) worst = { maxDrawdown: dd, accountId };
  }
  return worst;
}
