import { dedupeKey } from '../../trades/trade-identity.util';
import { roundCents } from '@mtc/shared';

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
  /** Fills de la paire (frais d'un fill partagé répartis au prorata, #947). */
  _buyFillId?: string;
  _sellFillId?: string;
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
  /**
   * Trades à fill partagé non réparés : un trade du groupe absent de la base ou sans frais recalculés,
   * ou total du groupe en base PLUS élevé que le recalcul (frais saisis à la main, jamais baissés).
   */
  skippedShared: number;
  /**
   * Trades à fill partagé remis au prorata (#950) : l'ancienne règle posait tous les frais du fill sur
   * le premier trade (2,18 / 0). Le groupe est réparé d'un bloc : chaque trade prend sa part recalculée
   * (un trade peut baisser), le TOTAL du groupe ne baisse jamais.
   */
  redistributed: number;
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
 *
 * Trades reliés par un fill commun (un fill qui sert plusieurs trades, de proche en proche) : traités
 * en GROUPE (#950). Monter seulement les trades à 0 compterait le fill deux fois ; le groupe entier
 * prend donc la répartition recalculée, à condition que son total en base ne dépasse pas le recalcul.
 */
export function planFeeRepairs(computed: RecomputedTrade[], stored: StoredTrade[]): FeeRepairPlan {
  const pool = new Map<string, StoredTrade[]>();
  for (const t of stored) {
    const k = dedupeKey(t);
    pool.set(k, [...(pool.get(k) ?? []), t]);
  }
  const plan: FeeRepairPlan = {
    updates: [], matched: 0, unchanged: 0, skippedLower: 0, noFees: 0, skippedShared: 0, redistributed: 0,
    notFound: 0, feesAdded: 0,
  };
  const hasFees = (c: RecomputedTrade) => typeof c.commission === 'number' && Number.isFinite(c.commission);

  // 1. Rapprochement un pour un, dans l'ordre du lot.
  const match = computed.map((c) => pool.get(dedupeKey(c))?.shift() ?? null);
  plan.notFound = match.filter((t) => !t).length;
  plan.matched = match.length - plan.notFound;

  // 2. Groupes de trades reliés par un fill commun (union-find sur les indices du lot).
  const parent = computed.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const firstUser = new Map<string, number>();
  computed.forEach((c, i) => {
    for (const f of [c._buyFillId, c._sellFillId]) {
      if (!f) continue;
      const j = firstUser.get(f);
      if (j === undefined) firstUser.set(f, i);
      else parent[root(i)] = root(j);
    }
  });
  const groups = new Map<number, number[]>();
  computed.forEach((_, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), i]));

  for (const idx of groups.values()) {
    if (idx.length > 1) {
      // Groupe à fill partagé : tout ou rien.
      const found = idx.filter((i) => match[i]);
      const complete = found.length === idx.length && idx.every((i) => hasFees(computed[i]));
      const next = idx.map((i) => roundCents(computed[i].commission ?? 0));
      const current = idx.map((i) => match[i]?.commission ?? 0);
      const sum = (xs: number[]) => roundCents(xs.reduce((s, x) => s + x, 0));
      if (!complete || sum(current) > sum(next) + CENT) {
        plan.skippedShared += found.length;
        continue;
      }
      idx.forEach((i, k) => {
        if (Math.abs(next[k] - current[k]) < CENT) {
          plan.unchanged++;
          return;
        }
        plan.updates.push({ id: (match[i] as StoredTrade).id, commission: next[k] });
        plan.redistributed++;
      });
      plan.feesAdded += sum(next) - sum(current);
      continue;
    }
    const [i] = idx;
    const t = match[i];
    if (!t) continue;
    const c = computed[i];
    if (!hasFees(c)) {
      plan.noFees++;
      continue;
    }
    const next = roundCents(c.commission as number);
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
  // Ordre des mises à jour = ordre du lot (lisible, stable).
  const order = new Map(match.map((t, i) => [t?.id, i]));
  plan.updates.sort((x, y) => (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0));
  plan.feesAdded = roundCents(plan.feesAdded);
  return plan;
}
