/**
 * Règles d'un plan prop firm mises en mots pour la landing — fonctions PURES, sans le
 * catalogue : importées par le rendu serveur ET par le script client du sélecteur, qui ne
 * reçoit que la version compacte (`prop-firm-catalog.ts`, JSON embarqué dans la page).
 */
export type PhaseKind = 'evaluation' | 'funded' | 'direct';

export interface CompactPhase {
  phase: PhaseKind;
  target: number | null;
  dd: { amount: number; type: string } | null;
  dll: { amount: number; tiered: boolean } | null;
  consistency: { pct: number; appliesTo: string | null } | null;
  payout: { minDays: number | null; minDailyProfit: number | null; splitPct: number | null; minAmount: number | null } | null;
}

export interface CompactPlan {
  id: string;
  label: string;
  size: number;
  currency: string;
  phases: CompactPhase[];
}

export interface CompactFirm {
  id: string;
  name: string;
  verifiedAt: string;
  plans: CompactPlan[];
}

export interface RuleRow {
  label: string;
  value: string;
  detail?: string;
}

export const PHASE_LABEL: Record<PhaseKind, string> = {
  evaluation: 'Évaluation',
  funded: 'Funded',
  direct: 'Funded direct',
};

const DD_TYPE: Record<string, string> = {
  trailing_eod: 'Trailing sur le plus haut solde de fin de journée (EOD)',
  trailing_intraday: 'Trailing en temps réel, latent compris (intraday)',
  static: 'Statique : plancher fixe',
};

const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };

/** 2000 → « 2 000 $ » (espaces fines insécables à la française). */
export function money(n: number, currency: string): string {
  const v = Math.round(n).toLocaleString('fr-FR').replace(/\s/g, ' ');
  return `${v} ${SYMBOL[currency] ?? currency}`;
}

const pct = (p: number) => `${Math.round(p * 100)} %`;

/** Lignes affichées pour une phase : objectif, drawdown, perte du jour, consistency, payout. */
export function ruleRows(p: CompactPhase, currency: string): RuleRow[] {
  const m = (n: number) => money(n, currency);
  const rows: RuleRow[] = [];
  rows.push(
    p.target !== null
      ? { label: 'Objectif', value: m(p.target) }
      : { label: 'Objectif', value: p.phase === 'evaluation' ? 'Aucun' : 'Aucun : place aux payouts' },
  );
  if (p.dd) rows.push({ label: 'Drawdown max', value: m(p.dd.amount), detail: DD_TYPE[p.dd.type] ?? p.dd.type });
  rows.push(
    p.dll
      ? { label: 'Perte du jour max', value: m(p.dll.amount), detail: p.dll.tiered ? 'Évolue par palier de profit' : undefined }
      : { label: 'Perte du jour max', value: 'Aucune' },
  );
  rows.push(
    p.consistency
      ? {
          label: 'Consistency',
          value: `Meilleur jour < ${pct(p.consistency.pct)} du profit`,
          detail: p.consistency.appliesTo === 'payout' ? 'Pour demander un payout' : 'Pour valider l’objectif',
        }
      : { label: 'Consistency', value: 'Aucune' },
  );
  if (p.phase !== 'evaluation' && p.payout) {
    const parts: string[] = [];
    const { minDays, minDailyProfit, splitPct, minAmount } = p.payout;
    if (minDays) parts.push(minDailyProfit ? `${minDays} jours à ${m(minDailyProfit)} min` : `${minDays} jours de trading`);
    if (minAmount) parts.push(`retrait min ${m(minAmount)}`);
    rows.push({
      label: 'Payout',
      value: splitPct ? `Split ${pct(splitPct)}` : 'Conditions du plan',
      detail: parts.length ? parts.join(' · ') : undefined,
    });
  }
  return rows;
}
