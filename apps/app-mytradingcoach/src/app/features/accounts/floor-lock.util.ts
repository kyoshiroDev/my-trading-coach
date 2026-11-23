import type { DrawdownPlanRule } from '../../core/api/accounts.api';
import { payoutLockPhrase } from '../../core/services/chart-series.util';

/**
 * Texte du gel du plancher dans la ligne « Marge calculée avec ces règles » de Mes comptes (#696) :
 * figé par le seuil, figé depuis le premier payout, ou à quelles conditions il se figera. Null si le
 * plan ne fige jamais le plancher.
 */
export function floorLockText(
  rule: Pick<DrawdownPlanRule, 'locked' | 'lockedBy' | 'payoutLockedSince' | 'locksAt' | 'lockedFloor' | 'locksOnFirstPayout'>,
  money: (v: number) => string,
): string | null {
  if (rule.locked && rule.lockedBy === 'payout' && rule.payoutLockedSince) {
    const [, m, d] = rule.payoutLockedSince.split('-');
    return `figé depuis ton payout du ${d}/${m}`;
  }
  if (rule.locked) return 'figé';
  const onPayout = rule.lockedFloor != null ? payoutLockPhrase(rule.locksOnFirstPayout) : null;
  if (rule.locksAt !== null && rule.lockedFloor != null) {
    return `se fige à ${money(rule.lockedFloor)} quand le solde atteint ${money(rule.locksAt)}${onPayout ? `, ou ${onPayout}` : ''}`;
  }
  if (onPayout) return `se fige à ${money(rule.lockedFloor!)} ${onPayout}`;
  return null;
}
