import type { TradovateAccount, TradovateFillPair, TradovatePosition } from './tradovate.types';

export interface TradovateSnapshotInput {
  accounts: TradovateAccount[];
  positions: TradovatePosition[];
  pairs: TradovateFillPair[];
  externalAccountId: number;
  /** Fills effectivement lus (`fill/list`, repli `fill/items`) pour les paires du compte. */
  fillsFetched: number;
}

const day = (p: TradovatePosition): string | null =>
  p.tradeDate
    ? `${p.tradeDate.year}-${String(p.tradeDate.month).padStart(2, '0')}-${String(p.tradeDate.day).padStart(2, '0')}`
    : null;

/**
 * Ce que Tradovate a RENVOYÉ lors d'une synchro, en une phrase de log.
 *
 * Pourquoi : « 0 trade importé » ne disait pas si Tradovate n'avait rien renvoyé (compte vide,
 * historique non exposé hors séance) ou si des données avaient été écartées (mauvais compte
 * choisi parmi ceux du login, paire sans position connue). Que des comptages et des dates de
 * séance : aucun prix, aucun P&L, aucun identifiant de fill.
 */
export function describeTradovateSnapshot(i: TradovateSnapshotInput): string {
  const own = i.positions.filter((p) => p.accountId === i.externalAccountId);
  const ownIds = new Set(own.map((p) => p.id));
  const knownIds = new Set(i.positions.map((p) => p.id));
  const ownPairs = i.pairs.filter((p) => ownIds.has(p.positionId)).length;
  const orphanPairs = i.pairs.filter((p) => !knownIds.has(p.positionId)).length;
  const days = own.map(day).filter((d): d is string => !!d).sort();
  const sessions = days.length ? `${days[0]} → ${days[days.length - 1]}` : '—';
  const open = own.filter((p) => p.netPos !== 0).length;

  return (
    `Tradovate a renvoyé ${i.accounts.length} compte(s) · ` +
    `${i.positions.length} position(s) : ${own.length} sur ce compte ` +
    `(séances ${sessions}, ${open} ouverte(s)), ${i.positions.length - own.length} sur les autres comptes du login · ` +
    `${i.pairs.length} paire(s) : ${ownPairs} rattachée(s) à ce compte, ${orphanPairs} sans position connue · ` +
    `${i.fillsFetched} fill(s) lu(s).`
  );
}
