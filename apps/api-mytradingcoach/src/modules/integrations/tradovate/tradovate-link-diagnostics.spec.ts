import { describe, it, expect } from 'vitest';
import {
  describeBracketLinks,
  LINK_DIAGNOSTIC_MAX_CHARS,
  linkDiagnosticEnabled,
  linkDiagnosticKey,
} from './tradovate-link-diagnostics';

// Valeurs repérables : aucune ne doit sortir dans le log.
const ACCOUNT = 72306699;
const E = 726724820683;
const STRAT = 555000111;
const order = (id: number, action: string, extra: Record<string, unknown> = {}) => ({
  id, accountId: ACCOUNT, contractId: 4470324, action, ordStatus: 'Canceled', ...extra,
});

describe('describeBracketLinks — diagnostic de liaison (#916)', () => {
  const orders = [
    order(E, 'Sell', { ordStatus: 'Filled' }),
    order(E + 3, 'Buy', { ocoId: E + 5 }),
    order(E + 5, 'Buy', { ordStatus: 'Filled', linkedId: E + 3 }),
    order(E + 40, 'Buy', { contractId: 999 }), // autre contrat : jamais décrit
    order(E + 7, 'Sell'), // même sens que l'entrée : jamais décrit
  ];
  const versions = [
    { id: 1, orderId: E + 3, orderType: 'Limit', price: 4032.5, stopPrice: null },
    { id: 2, orderId: E + 5, orderType: 'Stop', price: null, stopPrice: 4059.8 },
  ];
  const strategies = [{ id: STRAT, accountId: ACCOUNT, status: 'Completed' }];
  const strategyLinks = [
    { id: 1, orderStrategyId: STRAT, orderId: E, label: 'Entry' },
    { id: 2, orderStrategyId: STRAT, orderId: E + 3, label: 'TP-1' },
    { id: 3, orderStrategyId: STRAT + 1, orderId: E + 5, label: 'SL' },
  ];
  const out = describeBracketLinks({ entryOrderIds: [E, E, undefined], orders, versions, strategies, strategyLinks });

  it('décrit les jambes en écart d’id relatif, avec parentId / ocoId / linkedId et la stratégie', () => {
    expect(out).toContain('E1 Sell(parent=∅ oco=∅ linked=∅ strat=oui:Entry) →');
    expect(out).toContain('+3(Canceled parent=∅ oco=+5 linked=∅ strat=même:TP)');
    expect(out).toContain('+5(Filled parent=∅ oco=∅ linked=+3 strat=autre:SL)');
    expect(out).not.toContain('+40');
    expect(out).not.toContain('+7(');
    // Entrée en double : décrite une seule fois.
    expect(out).not.toContain('E2');
  });

  it('donne une fois les NOMS de champs bruts et les comptages', () => {
    expect(out).toContain('ordres 5, versions 2, stratégies 1, liens 3');
    expect(out).toContain('champs order[accountId,action,contractId,id,ordStatus]');
    expect(out).toContain('champs orderVersion[id,orderId,orderType,price,stopPrice]');
    expect(out).toContain('champs orderStrategyLink[id,label,orderId,orderStrategyId]');
  });

  it('ne sort jamais un prix, un compte ni un id brut', () => {
    for (const secret of ['4032', '4059', String(ACCOUNT), String(E), String(STRAT), '4470324']) {
      expect(out).not.toContain(secret);
    }
  });

  it('stratégies illisibles : le dit, décrit quand même les ordres', () => {
    const o = describeBracketLinks({ entryOrderIds: [E], orders, versions, strategies: null, strategyLinks: null });
    expect(o).toContain('stratégies illisible, liens illisible');
    expect(o).toContain('+3(Canceled parent=∅ oco=+5 linked=∅ strat=∅)');
  });

  it('entrée absente de /order/list : signalée, sans id', () => {
    const o = describeBracketLinks({ entryOrderIds: [123456789], orders, versions, strategies, strategyLinks });
    expect(o).toContain('E1 absente de /order/list');
    expect(o).not.toContain('123456789');
  });

  it('log borné', () => {
    const many = Array.from({ length: 400 }, (_, i) => E + 1000 * (i + 1));
    const big = [...orders, ...many.map((id) => order(id, 'Sell', { ordStatus: 'Filled' })),
      ...many.map((id) => order(id + 1, 'Buy'))];
    const o = describeBracketLinks({ entryOrderIds: many, orders: big, versions, strategies, strategyLinks });
    expect(o.length).toBeLessThanOrEqual(LINK_DIAGNOSTIC_MAX_CHARS);
  });
});

describe('interrupteur et clé du diagnostic', () => {
  it('éteint si absent ou autre que true', () => {
    expect(linkDiagnosticEnabled({})).toBe(false);
    expect(linkDiagnosticEnabled({ TRADOVATE_LINK_DIAGNOSTIC: 'false' })).toBe(false);
    expect(linkDiagnosticEnabled({ TRADOVATE_LINK_DIAGNOSTIC: '1' })).toBe(false);
    expect(linkDiagnosticEnabled({ TRADOVATE_LINK_DIAGNOSTIC: 'true' })).toBe(true);
  });

  it('une clé par connexion et par jour UTC', () => {
    expect(linkDiagnosticKey('c1', new Date('2026-11-12T23:59:59.000Z'))).toBe('tradovate:linkdiag:c1:2026-11-12');
    expect(linkDiagnosticKey('c1', new Date('2026-11-13T00:00:00.000Z'))).toBe('tradovate:linkdiag:c1:2026-11-13');
  });
});
