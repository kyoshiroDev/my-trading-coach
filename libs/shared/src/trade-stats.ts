/**
 * Statistiques de trades : SOURCE UNIQUE front + back (PROMPT-160, centralisée à l'étape 3 de
 * l'audit du 2026-09-13 — il y avait deux copies « miroir », identiques en logique).
 *
 * Un trade clôturé est classé en 3 résultats :
 *  - **win**       si `pnl >  ε`
 *  - **loss**      si `pnl < -ε`
 *  - **breakeven** si `|pnl| <= ε`
 *
 * `ε` (BREAKEVEN_EPSILON) est configurable : défaut `0` (BE = pnl exactement nul) ; élargissable
 * plus tard (near-BE). Un trade **ouvert** (pnl non renseigné) est hors calcul.
 *
 * **Win rate = wins / (wins + losses)** → les break-even ne sont PAS au dénominateur.
 * Toute mesure de win/loss/winRate dans le code doit passer par ce helper (plus de
 * `filter(t => t.pnl > 0)` suivi d'une division par `length` dispersé).
 *
 * Code PUR, sans dépendance : importable tel quel par Angular (esbuild) et NestJS (webpack).
 */

/** Seuil break-even : `|pnl| <= ε` → BE. Défaut 0 (BE = pnl exactement nul). */
export const BREAKEVEN_EPSILON = 0;

export type TradeOutcome = 'win' | 'loss' | 'breakeven';

/** Forme minimale d'un trade pour les stats (pnl null/undefined = ouvert → exclu). */
export interface TradeStatInput {
  /** P&L BRUT du trade (résultat des prix), frais à part. */
  pnl?: number | null;
  /** Frais du trade (commission, stockée positive). Déduits pour obtenir le net. */
  commission?: number | null;
}

/**
 * P&L NET d'un trade = pnl (brut) − frais. `null` si le trade est ouvert (pnl non renseigné).
 *
 * CONVENTION UNIQUE (PROMPT-213) : `pnl` est stocké BRUT, `commission` à part, et TOUT montant
 * affiché comme tout classement gagnant/perdant passe par ce net. Un trade à +1 $ brut avec
 * 1,90 $ de frais est une perte. Un appelant qui ne fournit pas `commission` obtient le brut :
 * toujours sélectionner `commission` avec `pnl`.
 */
export function netPnl(t: TradeStatInput): number | null {
  if (t.pnl == null) return null;
  return +(t.pnl - Math.abs(t.commission ?? 0)).toFixed(2);
}

export interface TradeStats {
  /** Tous les trades fournis (ouverts inclus). */
  total: number;
  /** Trades clôturés (pnl renseigné) = base du classement. */
  closed: number;
  wins: number;
  losses: number;
  breakeven: number;
  /** wins / (wins + losses), en POURCENTAGE (0-100). 0 si (wins + losses) === 0 (pas de /0). */
  winRate: number;
  /** Σ P&L NET (frais déduits) des trades clôturés. */
  totalPnl: number;
}

/** Classe un pnl en win / loss / breakeven selon le seuil ε. */
export function classifyTrade(
  pnl: number,
  epsilon: number = BREAKEVEN_EPSILON,
): TradeOutcome {
  if (pnl > epsilon) return 'win';
  if (pnl < -epsilon) return 'loss';
  return 'breakeven';
}

/**
 * Agrège les résultats d'un lot de trades, sur le P&L NET (cf. `netPnl`). Les trades ouverts
 * (pnl null/undefined) sont exclus du classement ; `total` les compte quand même.
 */
export function computeTradeStats<T extends TradeStatInput>(
  trades: readonly T[],
  epsilon: number = BREAKEVEN_EPSILON,
): TradeStats {
  let closed = 0;
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let totalPnl = 0;

  for (const t of trades) {
    const net = netPnl(t);
    if (net == null) continue; // ouvert → hors calcul
    closed++;
    totalPnl += net;
    switch (classifyTrade(net, epsilon)) {
      case 'win':
        wins++;
        break;
      case 'loss':
        losses++;
        break;
      default:
        breakeven++;
    }
  }

  const decisive = wins + losses;
  const winRate = decisive > 0 ? (wins / decisive) * 100 : 0;

  return { total: trades.length, closed, wins, losses, breakeven, winRate, totalPnl: +totalPnl.toFixed(2) };
}
