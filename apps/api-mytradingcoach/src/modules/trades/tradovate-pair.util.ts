/**
 * Règles Tradovate partagées entre l'import CSV (export Performance + Cash history) et la
 * synchro API (PROMPT-207). Une seule implémentation : un trade issu de l'API doit avoir
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
 * Attribue à chaque trade les frais de SES fills, chaque fill n'étant compté qu'UNE fois sur
 * tout le lot : un même fill peut clôturer un trade ET en ouvrir un autre (scalping, fills
 * partiels), et compter deux fois sa commission double-compte le net. Parcours dans l'ordre
 * du lot avec un Set de fills consommés — même règle pour le CSV et l'API.
 *
 * Mute `commission` (positive, arrondie au centime) sur chaque trade.
 */
export function assignFeesOncePerFill(
  trades: { _buyFillId?: string; _sellFillId?: string; commission?: number }[],
  feeByFill: Map<string, number>,
): { assigned: number; consumed: number } {
  const consumed = new Set<string>();
  let assigned = 0;
  for (const t of trades) {
    let fee = 0;
    for (const fid of [normFillId(t._buyFillId), normFillId(t._sellFillId)]) {
      if (fid && feeByFill.has(fid) && !consumed.has(fid)) {
        fee += feeByFill.get(fid) ?? 0;
        consumed.add(fid);
      }
    }
    t.commission = +fee.toFixed(2);
    assigned += fee;
  }
  return { assigned: +assigned.toFixed(2), consumed: consumed.size };
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
