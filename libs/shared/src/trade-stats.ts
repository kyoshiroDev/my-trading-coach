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
  pnl?: number | null;
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
  /** Σ pnl des trades clôturés. */
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
 * Agrège les résultats d'un lot de trades. Les trades ouverts (pnl null/undefined) sont exclus
 * du classement ; `total` les compte quand même.
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
    if (t.pnl == null) continue; // ouvert → hors calcul
    closed++;
    totalPnl += t.pnl;
    switch (classifyTrade(t.pnl, epsilon)) {
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

  return { total: trades.length, closed, wins, losses, breakeven, winRate, totalPnl };
}
