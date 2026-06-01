import { SessionTrade } from '../../core/api/session.api';
import { ObjectiveCheck } from '../../core/api/debrief.api';

/** Heure Paris « HH:MM » d'un ISO (pour le check trade_window). */
export function toParisHHMM(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Évalue un check structuré d'objectif contre les trades du jour.
 * Retourne true/false si auto-évaluable, ou null si le check est absent/inconnu
 * (l'objectif reste alors en validation manuelle — rétro-compat).
 */
export function evaluateObjectiveCheck(
  check: ObjectiveCheck | null | undefined,
  trades: SessionTrade[],
  journalLen: number,
): boolean | null {
  if (!check?.type) return null;
  const p = check.params ?? {};
  switch (check.type) {
    case 'max_trades':
      return trades.length <= Number(p['limit']);
    case 'min_trades':
      return trades.length >= Number(p['min']);
    case 'no_revenge':
      return !trades.some((t) => t.emotion === 'REVENGE');
    case 'all_stops':
      return trades.length > 0 && trades.every((t) => t.stopLoss != null);
    case 'min_rr': {
      const rr = trades.map((t) => t.riskReward).filter((v): v is number => v != null);
      return rr.length > 0 && rr.reduce((a, b) => a + b, 0) / rr.length >= Number(p['value']);
    }
    case 'journal_filled':
      return journalLen >= Number(p['minChars'] ?? 50);
    case 'trade_window':
      return trades.some((t) => {
        const hhmm = toParisHHMM(t.tradedAt);
        return hhmm >= String(p['start']) && hhmm <= String(p['end']);
      });
    case 'setup_only':
      return trades.length > 0 && trades.every((t) => ((p['setups'] as string[]) ?? []).includes(t.setup ?? ''));
    case 'max_loss_trades':
      return trades.filter((t) => (t.pnl ?? 0) < 0).length <= Number(p['limit']);
    default:
      return null;
  }
}
