import type { FillLeg } from '../../trades/tradovate-position-group.util';
import { toSecond } from './tradovate-trade.mapper';
import type { TradovateContract, TradovateFill, TradovateFillPair, TradovatePosition } from './tradovate.types';
import type { TradovateOrderEntity } from './tradovate-orders';

/**
 * Données de la séance pour le regroupement par position (#956), lues dans la Trade API. Pur.
 *
 * - Clé de regroupement : le contrat brut (MGCZ6) quand le compte n'a qu'UNE position sur ce
 *   contrat dans la liste ; sinon contrat + position (deux séances listées : on ne mélange pas).
 * - Position de départ et d'arrivée : `prevPos` / `netPos` de cette position.
 * - Exécutions non appariées (entrée d'une position encore ouverte) : `/fill/list` du login,
 *   rattachée au compte par l'ordre (`order.accountId`), seulement pour une clé « contrat seul ».
 *   Ordre inconnu = exécution écartée : le contrôle `netPos` met alors le contrat de côté plutôt
 *   que d'inventer une position close.
 */
export interface SessionPositionInput {
  keyOf: (pair: TradovateFillPair, contractName: string) => string;
  fills: FillLeg[];
  startNet: Map<string, number>;
  endNet: Map<string, number>;
}

export function sessionPositionInput(args: {
  accountPositions: TradovatePosition[];
  pairs: TradovateFillPair[];
  /** `/fill/list` complet (toutes les exécutions de la séance, tous comptes du login). */
  sessionFills: TradovateFill[];
  /** `/order/list`, ou null si illisible. */
  orders: TradovateOrderEntity[] | null;
  externalAccountId: number;
  contracts: Map<number, TradovateContract>;
}): SessionPositionInput {
  const { accountPositions, pairs, sessionFills, orders, externalAccountId, contracts } = args;
  const positionsByContract = new Map<number, TradovatePosition[]>();
  for (const p of accountPositions) {
    positionsByContract.set(p.contractId, [...(positionsByContract.get(p.contractId) ?? []), p]);
  }
  const positionById = new Map(accountPositions.map((p) => [p.id, p]));
  const single = (contractId: number) => (positionsByContract.get(contractId)?.length ?? 0) === 1;
  const keyOf = (pair: TradovateFillPair, contractName: string): string => {
    const pos = positionById.get(pair.positionId);
    return pos && single(pos.contractId) ? contractName : `${contractName}#${pair.positionId}`;
  };

  const startNet = new Map<string, number>();
  const endNet = new Map<string, number>();
  for (const pos of accountPositions) {
    const name = contracts.get(pos.contractId)?.name;
    if (!name) continue;
    const key = single(pos.contractId) ? name : `${name}#${pos.id}`;
    startNet.set(key, pos.prevPos ?? 0);
    endNet.set(key, pos.netPos ?? 0);
  }

  // Exécutions de CE compte (par l'ordre), sur un contrat à position unique, non annulées, et pas
  // antérieures à la première exécution appariée du contrat (séances précédentes encore listées).
  const fills: FillLeg[] = [];
  if (orders) {
    const accountOrders = new Set(
      orders.filter((o) => o.accountId === externalAccountId && o.id != null).map((o) => o.id as number),
    );
    const pairFillIds = new Set(pairs.flatMap((p) => [p.buyFillId, p.sellFillId]));
    const firstPaired = new Map<number, number>();
    for (const f of sessionFills) {
      if (!pairFillIds.has(f.id)) continue;
      const t = toSecond(f.timestamp).getTime();
      if (t < (firstPaired.get(f.contractId) ?? Infinity)) firstPaired.set(f.contractId, t);
    }
    for (const f of sessionFills) {
      if (f.active === false || !accountOrders.has(f.orderId) || !single(f.contractId)) continue;
      const name = contracts.get(f.contractId)?.name;
      const first = firstPaired.get(f.contractId);
      const at = toSecond(f.timestamp);
      if (!name || first === undefined || at.getTime() < first) continue;
      fills.push({ id: String(f.id), contract: name, action: f.action, qty: f.qty, at });
    }
  }
  return { keyOf, fills, startNet, endNet };
}
