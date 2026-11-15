import { describe, it, expect } from 'vitest';
import { CentRoundingPool, dedupeKey } from './trade-identity.util';

// Clé de dédoublonnage : le P&L y entre AU CENTIME (B1, #981). Le P&L stocké est maintenant arrondi par
// roundCents ; les trades importés avant gardent leur valeur brute. Les deux formes doivent donner la
// même clé, sinon un ré-import recréerait le trade.
describe('dedupeKey', () => {
  const t = { asset: 'EURUSD', side: 'LONG', tradedAt: '2026-06-01T10:00:00.000Z', entry: 1.1, exit: 1.2 };

  it('P&L brut et P&L arrondi au centime : même clé', () => {
    expect(dedupeKey({ ...t, pnl: 12.3456789 })).toBe(dedupeKey({ ...t, pnl: 12.35 }));
    expect(dedupeKey({ ...t, pnl: 0.1 + 0.2 })).toBe(dedupeKey({ ...t, pnl: 0.3 }));
    expect(dedupeKey({ ...t, pnl: 1231.495 })).toBe(dedupeKey({ ...t, pnl: 1231.5 }));
  });

  it('clé inchangée pour un P&L déjà au centime (empreintes existantes toujours valides)', () => {
    expect(dedupeKey({ ...t, pnl: -25 })).toBe('EURUSD|LONG|2026-06-01T10:00:00.000Z|1.1|1.2|-25');
    expect(dedupeKey({ ...t, pnl: 12.35 })).toBe('EURUSD|LONG|2026-06-01T10:00:00.000Z|1.1|1.2|12.35');
    expect(dedupeKey({ ...t, pnl: null })).toBe('EURUSD|LONG|2026-06-01T10:00:00.000Z|1.1|1.2|');
  });

  it('P&L qui diffèrent d’un centime : clés différentes', () => {
    expect(dedupeKey({ ...t, pnl: 12.35 })).not.toBe(dedupeKey({ ...t, pnl: 12.36 }));
  });
});

// Ancien arrondi `toFixed(2)` (valeur binaire) face à `roundCents` (valeur décimale) : sur un
// demi-centime, 1 centime d'écart (39,845 → 39,84 contre 39,85). Le trade stocké avant B1 garde
// son empreinte : sans rapprochement, le ré-import le recréerait.
describe('CentRoundingPool', () => {
  const t = { asset: 'ES', side: 'LONG', tradedAt: '2026-06-01T10:00:00.000Z', entry: 5000, exit: 5001 };

  it('même trade, P&L à 1 centime d’arrondi près : reconnu, une seule fois', () => {
    const pool = new CentRoundingPool([{ ...t, pnl: 39.84 }]);
    expect(pool.take({ ...t, pnl: 39.845 })).toBe(true);
    expect(pool.take({ ...t, pnl: 39.845 })).toBe(false); // un pour un
  });

  it('P&L identique au centime : laissé à la clé exacte (une répétition légitime n’est jamais absorbée)', () => {
    const pool = new CentRoundingPool([{ ...t, pnl: 39.85 }]);
    expect(pool.take({ ...t, pnl: 39.845 })).toBe(false);
  });

  it('contre-épreuves : 2 centimes d’écart, autre prix, autre date', () => {
    const pool = new CentRoundingPool([{ ...t, pnl: 39.84 }]);
    expect(pool.take({ ...t, pnl: 39.86 })).toBe(false);
    expect(pool.take({ ...t, exit: 5002, pnl: 39.85 })).toBe(false);
    expect(pool.take({ ...t, tradedAt: '2026-06-01T10:00:01.000Z', pnl: 39.85 })).toBe(false);
  });
});
