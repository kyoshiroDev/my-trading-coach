import { describe, expect, it } from 'vitest';
import { brutDepuisPrix, estTronque, pnlTronque, VALEUR_DU_POINT } from './pnl-milliers.util';
import { parseTradovatePnl } from './csv-parsers';

describe('pnl-milliers.util — détection des P&L tronqués', () => {
  it('valeurs du point dérivées du référentiel', () => {
    expect(VALEUR_DU_POINT.get('ES')).toBe(50);
    expect(VALEUR_DU_POINT.get('MNQ')).toBe(2);
    expect(VALEUR_DU_POINT.has('BTC/USDT')).toBe(false);
  });

  it('ligne du compte « test NT8 » (27/10) : enregistrée SHORT 7758,25 → 7753,75, P&L 1', () => {
    const enBase = { asset: 'ES', side: 'SHORT' as const, entry: 7758.25, exit: 7753.75, quantity: 5, pnl: 1 };
    // Le sens inversé échange aussi entrée et sortie : le brut recalculé reste le vrai, +1 125 $.
    expect(brutDepuisPrix(enBase)).toBe(1125);
    expect(estTronque(enBase)).toBe(true);
  });

  it.each([
    [1125, 1],
    [-1125, -1],
    [12345.67, 12],
    [-1234567.89, -1],
    [999.5, 999.5],
  ])('troncature de %d → %d', (brut, attendu) => {
    expect(pnlTronque(brut)).toBe(attendu);
  });

  it('la troncature reproduit EXACTEMENT l’ancien parseur', () => {
    const ancien = (raw: string) => parseFloat(raw.replace(/\$/g, '').replace(/^\((.*)\)$/, '-$1'));
    for (const [raw, brut] of [['$1,125.00', 1125], ['$(12,345.67)', -12345.67], ['$1,234,567.89', 1234567.89]] as const) {
      expect(ancien(raw)).toBe(pnlTronque(brut));
      expect(parseTradovatePnl(raw)).toBe(brut);
    }
  });

  it('pas touché : brut < 1 000, P&L juste, écart d’une autre origine, actif non vérifiable', () => {
    const base = { asset: 'ES', side: 'LONG' as const, entry: 7753.75, exit: 7758.25, quantity: 5 };
    expect(estTronque({ ...base, quantity: 1, pnl: 225 })).toBe(false);
    expect(estTronque({ ...base, pnl: 1125 })).toBe(false);
    expect(estTronque({ ...base, pnl: 1100 })).toBe(false);
    expect(estTronque({ ...base, asset: 'BTC/USDT', pnl: 1 })).toBe(false);
    expect(estTronque({ ...base, exit: null, pnl: 1 })).toBe(false);
  });
});
