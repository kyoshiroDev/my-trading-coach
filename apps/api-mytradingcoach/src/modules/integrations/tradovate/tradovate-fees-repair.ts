import { dedupeKey } from '../../trades/trade-identity.util';

/**
 * Réparation des frais Tradovate (#783), partie pure : quels trades corriger, et de combien.
 *
 * Avant le 31/10, l'import (historique et CSV) ne comptait que la commission (0,59 $ sur 2,18 $ par
 * côté-contrat sur ES). La réparation recalcule les trades depuis la Reporting API avec tous les
 * frais, et les rapproche des trades en base par leur clé d'import (actif, sens, date, entrée,
 * sortie, P&L brut) : le P&L brut ne change pas, seuls les frais.
 */

export interface RecomputedTrade {
  asset?: string | null;
  side?: string | null;
  tradedAt?: string | Date | null;
  entry?: number | null;
  exit?: number | null;
  pnl?: number | null;
  /** Frais complets recalculés ; absent = frais indisponibles sur la fenêtre. */
  commission?: number | null;
}

export interface StoredTrade extends RecomputedTrade {
  id: string;
}

export interface FeeRepairPlan {
  updates: { id: string; commission: number }[];
  /** Trades recalculés retrouvés en base. */
  matched: number;
  /** Frais déjà justes. */
  unchanged: number;
  /** Frais en base PLUS élevés que le recalcul (saisie manuelle, frais répartis) : jamais baissés. */
  skippedLower: number;
  /** Trade recalculé sans frais disponibles : rien à poser. */
  noFees: number;
  /** Trades recalculés absents de la base (trade supprimé, autre fuseau, autre source). */
  notFound: number;
  /** Σ des frais ajoutés par les mises à jour. */
  feesAdded: number;
}

/** Écart sous lequel deux montants sont égaux (centime). */
const CENT = 0.005;

/**
 * Rapproche un lot recalculé des trades en base. Deux trades de même clé (plusieurs paires d'un
 * même trade) se rapprochent un pour un, dans l'ordre : le n-ième recalculé avec le n-ième en base.
 * Les frais ne font que MONTER : un montant en base supérieur au recalcul vient d'ailleurs.
 */
export function planFeeRepairs(computed: RecomputedTrade[], stored: StoredTrade[]): FeeRepairPlan {
  const pool = new Map<string, StoredTrade[]>();
  for (const t of stored) {
    const k = dedupeKey(t);
    pool.set(k, [...(pool.get(k) ?? []), t]);
  }
  const plan: FeeRepairPlan = {
    updates: [], matched: 0, unchanged: 0, skippedLower: 0, noFees: 0, notFound: 0, feesAdded: 0,
  };
  for (const c of computed) {
    const candidates = pool.get(dedupeKey(c));
    const t = candidates?.shift();
    if (!t) {
      plan.notFound++;
      continue;
    }
    plan.matched++;
    if (typeof c.commission !== 'number' || !Number.isFinite(c.commission)) {
      plan.noFees++;
      continue;
    }
    const next = +c.commission.toFixed(2);
    const current = t.commission ?? 0;
    if (next > current + CENT) {
      plan.updates.push({ id: t.id, commission: next });
      plan.feesAdded += next - current;
    } else if (next < current - CENT) {
      plan.skippedLower++;
    } else {
      plan.unchanged++;
    }
  }
  plan.feesAdded = +plan.feesAdded.toFixed(2);
  return plan;
}
