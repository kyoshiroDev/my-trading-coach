import { stopWidenedDraft, stopWidening } from '../../behavior/behavior-stop';
import type { DemoDay, DemoTrade } from './model';

/**
 * E1 « stop éloigné » (#672) dans la démo : sur le trade NQ perdant le plus récent du compte Apex
 * (hors journée du jour), le stop éloigné de 6 ticks pendant le trade, avec l'alerte que le détecteur
 * aurait enregistrée. Module PUR (seed sous tsx) : n'importe aucun service Nest. Invisible tant que
 * l'affichage des alertes (#671) n'existe pas : la démo sera prête ce jour-là.
 */
const NQ_TICK = 0.25;

export function stopWidenedExample(days: readonly DemoDay[]): { trade: DemoTrade; alert: ReturnType<typeof stopWidenedDraft> & { createdAt: Date } } | null {
  const losing = days
    .filter((d) => d.account === 'apex' && d.kind !== 'today')
    .flatMap((d) => d.trades)
    .filter((t) => t.asset === 'NQ' && t.pnl < 0)
    .sort((a, b) => b.tradedAt.getTime() - a.tradedAt.getTime());
  const trade = losing[0];
  if (!trade) return null;
  const dir = trade.side === 'LONG' ? 1 : -1;
  // Stop posé à 8 ticks, éloigné à 14 ticks de l'entrée.
  const prevStop = trade.entry - dir * 8 * NQ_TICK;
  const nextStop = trade.entry - dir * 14 * NQ_TICK;
  const w = stopWidening({ side: trade.side, entryPrice: trade.entry, prevStop, nextStop, tickSize: NQ_TICK });
  if (!w) return null;
  const draft = stopWidenedDraft('NQ', w, { side: trade.side, entryPrice: trade.entry, prevStop, nextStop, quantity: trade.quantity });
  // Pendant le trade : deux minutes avant sa clôture.
  return { trade, alert: { ...draft, createdAt: new Date(trade.tradedAt.getTime() - 2 * 60_000) } };
}
