import { roundCents } from '@mtc/shared';
import type { ImportDto } from '../../trades/csv-parsers';
import { dedupeKey } from '../../trades/trade-identity.util';
import { detectTradingSession, normFillId } from '../../trades/tradovate-pair.util';
import { groupTradovateTrades } from '../../trades/tradovate-position-group.util';

/**
 * Réparation des trades Tradovate importés AVANT #956 (un trade par paire de fills) : les lignes
 * d'une même position sont fusionnées en UN trade, comme le fait désormais l'import. Pur, sans I/O.
 *
 * Source de vérité des positions : le rapport Performance recalculé (Reporting API), regroupé par
 * `groupTradovateTrades`. Chaque paire est rapprochée de SA ligne en base (même clé que l'import ;
 * repli à 1 centime près pour l'ancien arrondi `toFixed`). Une position n'est fusionnée que si :
 * - toutes ses paires sont retrouvées (sinon `incomplete`) ;
 * - sa clé `tv:` n'existe pas déjà en base (`alreadyGrouped`) ;
 * - les lignes ne diffèrent sur AUCUNE saisie de l'utilisateur ni sur leur séance (émotion, setup,
 *   stop, objectif, notes, tags, capital engagé, unité de temps, séance) : sinon `conflicting`,
 *   comptée, jamais fusionnée (décision du relecteur, issue #956).
 *
 * Le trade gardé est la ligne de la paire d'ouverture (ses saisies, sa date de création). Ses
 * champs du broker sont recalculés à partir des LIGNES EN BASE (pas du rapport) : le P&L et les
 * frais affichés jusque-là ne bougent pas au total.
 */

export interface StoredPairTrade {
  id: string;
  asset: string;
  side: string;
  tradedAt: Date;
  entry: number;
  exit: number | null;
  pnl: number | null;
  commission: number | null;
  quantity: number | null;
  importHash: string | null;
  emotion: string | null;
  setupId: string;
  stopLoss: number | null;
  takeProfit: number | null;
  notes: string | null;
  tags: string[];
  capitalEngaged: number | null;
  timeframe: string;
  sessionId: string | null;
}

export interface PositionMerge {
  key: string;
  keepId: string;
  removeIds: string[];
  data: {
    entry: number;
    exit: number | null;
    quantity: number;
    pnl: number | null;
    commission: number | null;
    tradedAt: Date;
    session: 'LONDON' | 'NEW_YORK' | 'ASIAN';
    importHash: string;
  };
}

export interface PositionRepairPlan {
  merges: PositionMerge[];
  /** Positions de plusieurs paires vues dans le rapport. */
  positions: number;
  incomplete: number;
  alreadyGrouped: number;
  conflicting: number;
}

/** Rapprochement un pour un, dans l'ordre : clé exacte, puis P&L à 1 centime près (ancien `toFixed`). */
function matchStored(computed: ImportDto[], stored: StoredPairTrade[]): (StoredPairTrade | null)[] {
  const pool = new Map<string, StoredPairTrade[]>();
  for (const t of stored) {
    const k = dedupeKey(t);
    pool.set(k, [...(pool.get(k) ?? []), t]);
  }
  const match = computed.map((c) => pool.get(dedupeKey(c))?.shift() ?? null);
  const rest = [...pool.values()].flat();
  computed.forEach((c, i) => {
    if (match[i] || c.pnl == null) return;
    const k = dedupeKey({ ...c, pnl: null });
    const p = roundCents(c.pnl);
    const j = rest.findIndex(
      (t) => t.pnl != null && dedupeKey({ ...t, pnl: null }) === k && Math.abs(Math.abs(roundCents(t.pnl) - p) - 0.01) < 0.001,
    );
    if (j >= 0) match[i] = rest.splice(j, 1)[0];
  });
  return match;
}

/** Saisies de l'utilisateur et séance : une seule valeur dans la position, sinon pas de fusion. */
function userFields(t: StoredPairTrade): string {
  return JSON.stringify([
    t.emotion, t.setupId, t.stopLoss, t.takeProfit, t.notes ?? null, [...(t.tags ?? [])].sort(),
    t.capitalEngaged, t.timeframe, t.sessionId,
  ]);
}

const roundPrice = (n: number) => Math.round(n * 1e8) / 1e8;

export function planPositionMerges(
  computed: ImportDto[],
  stored: StoredPairTrade[],
  /** Clés `tv:` déjà présentes en base pour ce user. */
  existingKeys: ReadonlySet<string>,
): PositionRepairPlan {
  const plan: PositionRepairPlan = { merges: [], positions: 0, incomplete: 0, alreadyGrouped: 0, conflicting: 0 };
  const grouped = groupTradovateTrades(computed, { leftovers: 'skip' });
  const groups = grouped.trades.filter((t) => t._positionKey && (t._pairs?.length ?? 0) > 1);
  plan.positions = groups.length;
  if (groups.length === 0) return plan;

  // Rapprochement sur TOUTES les paires du rapport (l'ordre des répétitions compte).
  const match = matchStored(computed, stored);
  const rowOf = new Map<ImportDto, StoredPairTrade | null>(computed.map((c, i) => [c, match[i]]));

  for (const g of groups) {
    const key = g._positionKey as string;
    if (existingKeys.has(key)) {
      plan.alreadyGrouped++;
      continue;
    }
    const pairs = g._pairs as ImportDto[];
    const rows = pairs.map((p) => rowOf.get(p) ?? null);
    if (rows.some((r) => !r) || new Set(rows.map((r) => r!.id)).size !== rows.length) {
      plan.incomplete++;
      continue;
    }
    const list = rows as StoredPairTrade[];
    if (new Set(list.map(userFields)).size > 1 || new Set(list.map((r) => r.side)).size > 1) {
      plan.conflicting++;
      continue;
    }
    const openIdx = pairs.findIndex((p) => normFillId(p._buyFillId) === g._openFillId || normFillId(p._sellFillId) === g._openFillId);
    const keep = list[openIdx >= 0 ? openIdx : 0];

    let qty = 0;
    let entryW = 0;
    let exitW = 0;
    let hasExit = true;
    let pnl = 0;
    let hasPnl = false;
    let commission = 0;
    let hasCommission = false;
    let last = list[0].tradedAt;
    for (const r of list) {
      const q = r.quantity != null && r.quantity > 0 ? r.quantity : 1;
      qty += q;
      entryW += r.entry * q;
      if (r.exit == null) hasExit = false;
      else exitW += r.exit * q;
      if (r.pnl != null) {
        pnl += r.pnl;
        hasPnl = true;
      }
      if (r.commission != null) {
        commission += r.commission;
        hasCommission = true;
      }
      if (r.tradedAt.getTime() > last.getTime()) last = r.tradedAt;
    }
    plan.merges.push({
      key,
      keepId: keep.id,
      removeIds: list.filter((r) => r.id !== keep.id).map((r) => r.id),
      data: {
        entry: roundPrice(entryW / qty),
        exit: hasExit ? roundPrice(exitW / qty) : null,
        quantity: qty,
        pnl: hasPnl ? roundCents(pnl) : null,
        commission: hasCommission ? roundCents(commission) : null,
        tradedAt: last,
        session: detectTradingSession(last.toISOString()),
        importHash: key,
      },
    });
  }
  return plan;
}
