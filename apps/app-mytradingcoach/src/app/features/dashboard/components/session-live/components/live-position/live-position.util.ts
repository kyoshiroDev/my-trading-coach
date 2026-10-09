import type { LiveBrokerState } from '@mtc/shared';

/**
 * Bloc « Trade en cours » (bêta) : rôles qui le voient pendant la phase de test. Val
 * (ambassadrice) a remonté le retour : elle doit pouvoir le retester.
 */
export const LIVE_POSITION_ROLES: readonly string[] = ['BETA_TESTER', 'ADMIN', 'AMBASSADOR'];

export interface LiveTotals {
  /** P&L réalisé de la session (trades clôturés, net des frais). */
  realized: number;
  /** Latent du broker ; `null` = inconnu. */
  latent: number | null;
  /** Réalisé + latent, comparable au broker ; `null` tant que le latent est inconnu. */
  total: number | null;
  hasPosition: boolean;
}

/** Réalisé (MTC) + latent (broker). Latent inconnu avec position ouverte → pas de total inventé. */
export function liveTotals(realized: number, broker: LiveBrokerState | null | undefined): LiveTotals {
  const hasPosition = (broker?.openPositions.length ?? 0) > 0;
  const latent = broker ? (hasPosition ? broker.openPnl : (broker.openPnl ?? 0)) : null;
  return {
    realized,
    latent,
    total: latent === null ? null : Math.round((realized + latent) * 100) / 100,
    hasPosition,
  };
}

/** Âge d'une lecture du broker, à la seconde près sous la minute (« il y a 40 s »). */
export function ageLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return 'jamais lu';
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (Number.isNaN(s)) return 'jamais lu';
  if (s < 5) return "à l'instant";
  if (s < 60) return `il y a ${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `il y a ${min} min`;
  return `il y a ${Math.floor(min / 60)} h`;
}

/**
 * « Trade en cours » (stats live) et « Suivi du compte » (comptes) lisent le même relevé broker par
 * deux requêtes qui ne partent pas ensemble (stats sondées toutes les 30 s, « Actualiser »…) : l'un
 * pouvait afficher un latent plus récent que l'autre (retour de Val, 2026-10-09). Renvoie le panneau
 * en retard à relire, `null` s'ils montrent le même relevé ou qu'on ne peut pas comparer.
 */
export function laggingBrokerPanel(liveAt: string | null | undefined, accountAt: string | null | undefined): 'live' | 'account' | null {
  if (!liveAt || !accountAt) return null;
  const live = new Date(liveAt).getTime();
  const account = new Date(accountAt).getTime();
  if (Number.isNaN(live) || Number.isNaN(account) || live === account) return null;
  return live > account ? 'account' : 'live';
}
