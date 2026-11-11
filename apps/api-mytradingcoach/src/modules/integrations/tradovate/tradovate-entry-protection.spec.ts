import { describe, it, expect } from 'vitest';
import { countOutcomes, entryProtection, firstVersions } from './tradovate-entry-protection';
import type { TradovateOrderEntity, TradovateOrderVersionEntity } from './tradovate-orders';

const ACC = 777;
const MNQ = 3001;

// Bracket MNQ du 9/11 (rapport Orders) : entrée Buy limite, stop et objectif Sell, même compte.
const entry: TradovateOrderEntity = { id: 216, accountId: ACC, contractId: MNQ, action: 'Buy', ordStatus: 'Filled' };
const target: TradovateOrderEntity = { id: 223, accountId: ACC, contractId: MNQ, action: 'Sell', ordStatus: 'Canceled', parentId: 216, ocoId: 225 };
const stop: TradovateOrderEntity = { id: 225, accountId: ACC, contractId: MNQ, action: 'Sell', ordStatus: 'Canceled', parentId: 216, ocoId: 223 };

const v = (id: number, orderId: number, orderType: string, price: number | null, stopPrice: number | null): TradovateOrderVersionEntity =>
  ({ id, orderId, orderType, price, stopPrice });

const versions = [
  v(1216, 216, 'Limit', 27098.75, null),
  v(1223, 223, 'Limit', 28000, null), // objectif posé à l'entrée…
  v(1247, 223, 'Limit', 28138.25, null), // …puis déplacé 6 h plus tard
  v(1225, 225, 'Stop', null, 26862.5),
];

const run = (orders: TradovateOrderEntity[], vs = versions, over: Partial<Parameters<typeof entryProtection>[0]> = {}) =>
  entryProtection({ entryOrderId: 216, side: 'LONG', entryPrice: 27092.25, orders, first: firstVersions(vs), ...over });

describe('entryProtection — stop et objectif initiaux liés à l’ordre d’entrée', () => {
  it('bracket lié par parentId : stop et objectif de la PREMIÈRE version', () => {
    expect(run([entry, target, stop])).toEqual({ outcome: 'linked', stopLoss: 26862.5, takeProfit: 28000 });
  });

  it('stop déplacé ensuite : garde le prix de départ', () => {
    const moved = [...versions, v(1300, 225, 'Stop', null, 27000)];
    expect(run([entry, target, stop], moved).stopLoss).toBe(26862.5);
  });

  it('jambe sans parentId mais en OCO avec une jambe du bracket : retrouvée', () => {
    const stopOco = { ...stop, parentId: null };
    expect(run([entry, target, stopOco])).toEqual({ outcome: 'linked', stopLoss: 26862.5, takeProfit: 28000 });
  });

  it('SHORT : stop au-dessus, objectif en dessous', () => {
    const e = { ...entry, action: 'Sell' };
    const s = { ...stop, action: 'Buy' };
    const t = { ...target, action: 'Buy' };
    const vs = [v(1, 225, 'Stop', null, 101), v(2, 223, 'Limit', 95, null)];
    expect(run([e, s, t], vs, { side: 'SHORT', entryPrice: 100 })).toEqual({ outcome: 'linked', stopLoss: 101, takeProfit: 95 });
  });

  it('trailing stop accepté, avec le prix de sa première version', () => {
    const vs = [v(1, 225, 'TrailingStop', null, 26900)];
    expect(run([entry, stop], vs)).toEqual({ outcome: 'linked', stopLoss: 26900 });
  });

  it('aucune jambe liée (pas de parentId, pas d’OCO) : rien', () => {
    const loose = [{ ...stop, parentId: null, ocoId: null }, { ...target, parentId: null, ocoId: null }];
    expect(run([entry, ...loose])).toEqual({ outcome: 'no-leg' });
  });

  it('ordre d’entrée absent de la séance (synchro trop tardive) : « séance passée »', () => {
    expect(run([target, stop])).toEqual({ outcome: 'session-gone' });
    expect(run([entry, target, stop], versions, { entryOrderId: undefined })).toEqual({ outcome: 'session-gone' });
  });

  it('deux stops liés : ambigu, le stop n’est pas posé (l’objectif unique, si)', () => {
    const stop2 = { ...stop, id: 226, ocoId: null };
    const vs = [...versions, v(1226, 226, 'Stop', null, 26800)];
    expect(run([entry, target, stop, stop2], vs)).toEqual({ outcome: 'linked', takeProfit: 28000 });
    const onlyStops = run([entry, stop, { ...stop2 }], vs);
    expect(onlyStops).toEqual({ outcome: 'ambiguous' });
  });

  it('autre compte, autre contrat ou même sens que l’entrée : jamais une jambe', () => {
    expect(run([entry, { ...stop, accountId: 999, ocoId: null }])).toEqual({ outcome: 'no-leg' });
    expect(run([entry, { ...stop, contractId: 9, ocoId: null }])).toEqual({ outcome: 'no-leg' });
    expect(run([entry, { ...stop, action: 'Buy', ocoId: null }])).toEqual({ outcome: 'no-leg' });
  });

  it('stop du mauvais côté de l’entrée : écarté', () => {
    const vs = [v(1, 225, 'Stop', null, 27200)];
    expect(run([entry, stop], vs)).toEqual({ outcome: 'ambiguous' });
  });

  it('type inconnu (Market, MIT) : ignoré', () => {
    const vs = [v(1, 225, 'MIT', 27000, null)];
    expect(run([entry, stop], vs)).toEqual({ outcome: 'ambiguous' });
  });
});

describe('firstVersions / countOutcomes', () => {
  it('garde la plus petite version de chaque ordre, quel que soit l’ordre d’arrivée', () => {
    const f = firstVersions([v(9, 1, 'Stop', null, 2), v(3, 1, 'Stop', null, 1), v(4, 2, 'Limit', 5, null)]);
    expect(f.get(1)?.stopPrice).toBe(1);
    expect(f.get(2)?.price).toBe(5);
  });

  it('compte chaque issue', () => {
    expect(countOutcomes(['linked', 'linked', 'no-leg', 'session-gone'])).toEqual({ linked: 2, 'no-leg': 1, ambiguous: 0, 'session-gone': 1 });
  });
});
