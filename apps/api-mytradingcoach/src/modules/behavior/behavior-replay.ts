import type { PropFirmPhaseRules } from '@mtc/shared';
import { computeBaseline, type BehaviorBaselineData } from './behavior-baseline';
import {
  type BehaviorAlertDraft,
  type BehaviorAlertType,
  type EntryContext,
  applyAntiSpam,
  evaluateEntry,
} from './behavior-detectors';
import { dailyLossLimitAt, maxContractsAt } from './behavior-plan';
import { type BehaviorPosition, type BehaviorSession, type BehaviorTrade, groupPositions, groupSessions } from './behavior-positions';

/**
 * Rejeu silencieux de l'historique (#602) — PUR, utilisé par `scripts/replay-behavior-alerts.ts`.
 *
 * Les séances sont rejouées dans l'ordre chronologique ; la référence de chaque séance est calculée
 * UNIQUEMENT sur les journées précédentes (aucune triche avec le futur, test dédié).
 *
 * Limites assumées de l'historique (cf. audit) :
 * - l'heure d'entrée n'est pas en base : l'entrée d'une position est datée de sa PREMIÈRE sortie,
 *   comme dans la référence (mesure cohérente des deux côtés, qui majore le délai réel) ;
 * - la taille ouverte (A1, A2) est la borne basse `maxExitQuantity` : jamais de faux dépassement ;
 * - la perte du jour (A2, A3) ne compte que le réalisé avant l'entrée (latent inconnu).
 */

export interface ReplayAccount {
  /** Capital de départ du compte (référentiel du plan), pour les paliers. */
  startingBalance: number;
  /** Phase du plan relié, `null` sans plan : A muet. */
  phase: PropFirmPhaseRules | null;
}

export interface ReplayInput {
  trades: BehaviorTrade[];
  accounts: ReadonlyMap<string, ReplayAccount>;
  tradesPerDayMax: number | null;
}

export interface ReplayAlert extends BehaviorAlertDraft {
  sessionKey: string;
  /** Position dont l'entrée déclenche l'alerte (index dans la séance). */
  positionIndex: number;
  at: Date;
}

export interface ReplaySession extends BehaviorSession {
  alerts: ReplayAlert[];
  /** Référence utilisée (calculée sur les journées précédentes seulement). */
  baseline: BehaviorBaselineData;
  dailyLossLimit: number | null;
  /** Plus bas du P&L réalisé cumulé dans la séance (≤ 0), et position où il est atteint. */
  low: number;
  lowIndex: number;
}

export function replay(input: ReplayInput): ReplaySession[] {
  const sessions = groupSessions(groupPositions(input.trades));
  /** Réalisé cumulé par compte, journées précédentes seulement. */
  const realized = new Map<string, number>();
  const baselines = new Map<string, BehaviorBaselineData>();
  const out: ReplaySession[] = [];

  for (const s of sessions) {
    let baseline = baselines.get(s.day);
    if (!baseline) {
      baseline = computeBaseline(sessions, s.day);
      baselines.set(s.day, baseline);
    }
    const account = s.accountId ? input.accounts.get(s.accountId) ?? null : null;
    const prevProfit = realized.get(s.accountId ?? '') ?? 0;
    const maxContracts = maxContractsAt(account?.phase?.max_contracts, prevProfit);
    const dailyLossLimit = account ? dailyLossLimitAt(account.phase, prevProfit) : null;

    const alerts: ReplayAlert[] = [];
    const lastSent = new Map<BehaviorAlertType, number>();
    let dayPnl = 0;
    let low = 0;
    let lowIndex = -1;
    s.positions.forEach((p: BehaviorPosition, i) => {
      const at = p.firstExitAt;
      const open = [{ asset: p.asset, side: p.side, quantity: p.maxExitQuantity }];
      const ctx: EntryContext = {
        at,
        entry: { asset: p.asset, side: p.side, quantity: p.quantity },
        open,
        closed: s.positions.slice(0, i),
        baseline,
        maxContracts,
        dailyLoss: dailyLossLimit != null ? { limit: dailyLossLimit, used: Math.max(0, -dayPnl) } : null,
        tradesPerDayMax: input.tradesPerDayMax,
      };
      for (const a of applyAntiSpam(evaluateEntry(ctx), lastSent, at)) {
        alerts.push({ ...a, sessionKey: s.key, positionIndex: i, at });
      }
      dayPnl += p.pnl;
      if (dayPnl < low) {
        low = dayPnl;
        lowIndex = i;
      }
    });
    realized.set(s.accountId ?? '', prevProfit + dayPnl);
    out.push({ ...s, alerts, baseline, dailyLossLimit, low, lowIndex });
  }
  return out;
}
