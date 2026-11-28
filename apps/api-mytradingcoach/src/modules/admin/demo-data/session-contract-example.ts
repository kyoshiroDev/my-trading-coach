import { assetRoot, trailingLosses, type SessionContractEdit, type SessionContractRules } from '@mtc/shared';
import { type DemoDay, net } from './model';

/**
 * Contrat de session de la démo (#667) : visible au débrief de séance quand `SESSION_CONTRACT_ENABLED` est
 * allumé. Module PUR (seed sous tsx). Sur la séance clôturée la plus récente d'au moins 4 trades : trades max
 * fixé 2 sous le nombre de trades (infraction à l'avant-dernier, 1 trade « ensuite »), relevé de 1 juste après
 * (modification tracée, l'infraction reste comptée) ; perte max et actifs tenus ; annonces ±5 min.
 */
export interface DemoSessionContract {
  /** Journée de la séance (clé du seed : `daysAgo` + compte). */
  daysAgo: number;
  account: DemoDay['account'];
  rules: SessionContractRules;
  edits: SessionContractEdit[];
}

export function sessionContractExample(days: readonly DemoDay[]): DemoSessionContract | null {
  const day = [...days]
    .filter((d) => d.kind !== 'today' && d.trades.filter((t) => t.pnl != null).length >= 4)
    .sort((a, b) => a.daysAgo - b.daysAgo)[0];
  if (!day) return null;
  const closed = day.trades.filter((t) => t.pnl != null).sort((a, b) => a.tradedAt.getTime() - b.tradedAt.getTime());
  const n = closed.length;
  const maxTrades = n - 2;
  const breach = closed[maxTrades];
  let cum = 0;
  let worst = 0;
  for (const t of closed) worst = Math.min(worst, (cum += net(t)));
  const streak = Math.max(...closed.map((_, i) => trailingLosses(closed.slice(0, i + 1).map(net))));
  return {
    daysAgo: day.daysAgo,
    account: day.account,
    rules: {
      // Tenue : 100 $ sous le pire cumul de la séance, arrondi à la centaine.
      maxDailyLoss: Math.ceil((Math.abs(worst) + 100) / 100) * 100,
      maxConsecutiveLosses: Math.max(streak, 1) + 1,
      maxTrades: maxTrades + 1,
      newsMinutes: 5,
      allowedAssets: [...new Set(closed.map((t) => assetRoot(t.asset)))],
    },
    edits: [{ at: new Date(breach.tradedAt.getTime() + 60_000).toISOString(), field: 'maxTrades', from: maxTrades, to: maxTrades + 1 }],
  };
}
