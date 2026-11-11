/**
 * Règles Tradovate partagées entre l'import CSV (export Performance + Cash history) et la
 * synchro API. Une seule implémentation : un trade issu de l'API doit avoir
 * EXACTEMENT la forme d'un trade issu du CSV (même sens, même entrée/sortie, même date, mêmes
 * frais), sinon scoring, analytics et débrief verraient deux produits différents.
 *
 * Unité de base = une paire de fills (achat + vente) : c'est ce que Tradovate appelle un
 * `fillPair`, et c'est aussi une ligne de l'export Performance (colonnes buyFillId/sellFillId).
 */

export type PairSide = 'LONG' | 'SHORT';

/** Code mois + année d'un futures : MNQM6 → MNQ, ESZ25 → ES, 6EH6 → 6E. */
export function normalizeFuturesSymbol(raw: string): string {
  return raw.trim().replace(/[FGHJKMNQUVXZ]\d{1,2}$/, '');
}

/**
 * Sens d'une paire : l'achat avant la vente = LONG, sinon SHORT. Entrée = la jambe
 * d'ouverture, sortie = la jambe de clôture, date du trade = la clôture.
 */
export function resolvePairDirection(p: {
  buyPrice: number;
  sellPrice: number;
  boughtAt: Date;
  soldAt: Date;
}): { side: PairSide; entry: number; exit: number; tradedAt: Date } {
  const side: PairSide = p.boughtAt <= p.soldAt ? 'LONG' : 'SHORT';
  return side === 'LONG'
    ? { side, entry: p.buyPrice, exit: p.sellPrice, tradedAt: p.soldAt }
    : { side, entry: p.sellPrice, exit: p.buyPrice, tradedAt: p.boughtAt };
}

/** Normalise un fill id (numérique) → chaîne canonique, ou null si invalide. */
export function normFillId(raw?: string | number | null): string | null {
  if (raw == null || raw === '') return null;
  const n = parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) ? String(n) : null;
}

/**
 * Attribue à chaque trade les frais de SES fills. Un même fill peut servir plusieurs trades (un
 * achat de 2 contrats clôturé en deux ventes, ou un fill qui clôture un trade et en ouvre un autre) :
 * ses frais sont RÉPARTIS entre ces trades au prorata de leur quantité, et ne sont jamais comptés
 * deux fois sur le lot. Avant (#947), tout le fill allait au premier trade et 0 aux suivants : total
 * juste, mais net par trade faux (un trade gagnant pouvait s'afficher perdant, et l'inverse).
 * Répartition au centime : le dernier trade du fill prend le reste, la somme = frais du fill.
 * Même règle pour le CSV et l'API.
 *
 * Mute `commission` (positive, arrondie au centime) sur chaque trade.
 */
export function assignFeesOncePerFill(
  trades: { _buyFillId?: string; _sellFillId?: string; commission?: number; quantity?: number | null }[],
  feeByFill: Map<string, number>,
): { assigned: number; consumed: number } {
  const qty = (t: { quantity?: number | null }) => (t.quantity != null && t.quantity > 0 ? t.quantity : 1);
  const fillsOf = (t: { _buyFillId?: string; _sellFillId?: string }) =>
    [...new Set([normFillId(t._buyFillId), normFillId(t._sellFillId)])].filter(
      (fid): fid is string => !!fid && feeByFill.has(fid),
    );

  // Trades de chaque fill (dans l'ordre du lot) et quantité totale servie par ce fill.
  const users = new Map<string, number[]>();
  trades.forEach((t, i) => {
    for (const fid of fillsOf(t)) users.set(fid, [...(users.get(fid) ?? []), i]);
  });

  const cents = new Array<number>(trades.length).fill(0);
  let assignedCents = 0;
  for (const [fid, idx] of users) {
    const feeCents = Math.round((feeByFill.get(fid) ?? 0) * 100);
    const totalQty = idx.reduce((sum, i) => sum + qty(trades[i]), 0);
    let left = feeCents;
    idx.forEach((i, k) => {
      const share = k === idx.length - 1 ? left : Math.round((feeCents * qty(trades[i])) / totalQty);
      cents[i] += share;
      left -= share;
    });
    assignedCents += feeCents;
  }
  trades.forEach((t, i) => (t.commission = cents[i] / 100));
  return { assigned: assignedCents / 100, consumed: users.size };
}

/** Session de marché selon l'heure UTC de clôture (même découpage pour tous les imports). */
export function detectTradingSession(iso: string): 'LONDON' | 'NEW_YORK' | 'ASIAN' {
  // Date invalide → NaN : aucune borne ne matche, on retombe sur LONDON (comportement
  // historique de l'import, conservé à l'identique).
  const hour = new Date(iso).getUTCHours();
  if (hour >= 0 && hour < 8) return 'ASIAN';
  if (hour >= 8 && hour < 13) return 'LONDON';
  if (hour >= 13 && hour < 22) return 'NEW_YORK';
  return 'LONDON';
}
