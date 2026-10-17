import { describe, it, expect } from 'vitest';
import type { EcoEvent } from '@mtc/shared';
import type { InstrumentDto } from '@app/core/api/trades.api';
import {
  closeKind, countdownLabel, nextAnnouncement, pointValue, positionBar, priceFromLatent,
} from './session-live.util';

// Extrait de instruments.const.ts (API) : valeur du point = tickValue / tickSize.
const INSTRUMENTS: InstrumentDto[] = [
  { symbol: 'MNQ', label: 'MNQ', category: 'FUTURES_US', tickValue: 0.5, tickSize: 0.25 },
  { symbol: 'NQ', label: 'NQ', category: 'FUTURES_US', tickValue: 5, tickSize: 0.25 },
  { symbol: 'MES', label: 'MES', category: 'FUTURES_US', tickValue: 1.25, tickSize: 0.25 },
  { symbol: 'ES', label: 'ES', category: 'FUTURES_US', tickValue: 12.5, tickSize: 0.25 },
];

describe('pointValue', () => {
  it.each([['MNQ', 2], ['NQ', 20], ['ES', 50], ['MES', 5]])('%s → %d $/pt', (asset, pv) => {
    expect(pointValue(asset, INSTRUMENTS)).toBe(pv);
  });
  it('actif inconnu → null', () => expect(pointValue('XYZ', INSTRUMENTS)).toBeNull());
});

describe('positionBar (#598)', () => {
  it('LONG MNQ avec SL et TP : barre complète, montants et R/R (maquette)', () => {
    const bar = positionBar({ side: 'LONG', entry: 18540, stop: 18500, target: 18620, current: 18520, quantity: 2, pv: 2 });
    expect(bar).toMatchObject({
      mode: 'full', stopPct: 0, targetPct: 100, entryPct: 33.3, currentPct: 16.7, inGain: false,
      stopAmount: -160, targetAmount: 320, rr: 2, stopPts: 40,
    });
  });

  it.each([
    ['NQ', 20, -400, 800],
    ['ES', 50, -1000, 2000],
    ['MES', 5, -100, 200],
  ])('%s, 1 contrat, stop 20 pts / TP 40 pts', (_asset, pv, sl, tp) => {
    const bar = positionBar({ side: 'LONG', entry: 100, stop: 80, target: 140, current: null, quantity: 1, pv });
    expect([bar.stopAmount, bar.targetAmount, bar.rr]).toEqual([sl, tp, 2]);
  });

  it('SHORT : l’axe va toujours du stop (gauche) au TP (droite)', () => {
    const bar = positionBar({ side: 'SHORT', entry: 5905, stop: 5915, target: 5885, current: 5900, quantity: 1, pv: 50 });
    expect(bar).toMatchObject({ mode: 'full', entryPct: 33.3, currentPct: 50, inGain: true, stopAmount: -500, targetAmount: 1000 });
  });

  it('sans SL ni TP : repli, aucune borne ni montant inventés', () => {
    const bar = positionBar({ side: 'LONG', entry: 18540, stop: null, target: null, current: 18520, quantity: 2, pv: 2 });
    expect(bar).toEqual({
      mode: 'fallback', entryPct: 50, stopPct: null, targetPct: null, currentPct: 0, inGain: false,
      stopAmount: null, targetAmount: null, rr: null, stopPts: null,
    });
  });

  it('sans SL, TP connu : seul ce côté', () => {
    const bar = positionBar({ side: 'LONG', entry: 100, stop: null, target: 120, current: 110, quantity: 1, pv: 2 });
    expect(bar).toMatchObject({ mode: 'target', stopPct: null, stopAmount: null, rr: null, targetAmount: 40, currentPct: 50 });
  });

  it('SL du mauvais côté de l’entrée : ignoré (ce n’est pas une protection)', () => {
    expect(positionBar({ side: 'LONG', entry: 100, stop: 110, target: null, current: null, quantity: 1, pv: 2 }).mode).toBe('fallback');
  });

  it('prix inconnu : pas de pastille', () => {
    expect(positionBar({ side: 'LONG', entry: 100, stop: 90, target: 120, current: null, quantity: 1, pv: 2 }).currentPct).toBeNull();
  });
});

describe('priceFromLatent', () => {
  it('LONG MNQ 2 contrats, latent -80 $ → 20 pts sous l’entrée', () => {
    expect(priceFromLatent('LONG', 18540, 2, -80, 2)).toBe(18520);
  });
  it('SHORT : latent positif = prix sous l’entrée', () => {
    expect(priceFromLatent('SHORT', 5905, 1, 250, 50)).toBe(5900);
  });
  it('latent ou valeur du point inconnus → null', () => {
    expect(priceFromLatent('LONG', 18540, 2, null, 2)).toBeNull();
    expect(priceFromLatent('LONG', 18540, 2, -80, null)).toBeNull();
  });
});

describe('nextAnnouncement (#593)', () => {
  const ev = (time: string, isReleased = false, name = 'PMI'): EcoEvent => ({
    time, name, impact: 'high', country: 'US', currency: 'USD', actual: null, estimate: null, previous: null, isReleased,
  });
  const now = new Date(2026, 9, 17, 10, 12);

  it('la plus proche non publiée, compte à rebours en minutes', () => {
    expect(nextAnnouncement([ev('14:30'), ev('10:30', false, 'PMI UK'), ev('09:00')], now))
      .toMatchObject({ event: { name: 'PMI UK' }, minutes: 18 });
  });

  it('aucune annonce restante aujourd’hui → null (ligne absente)', () => {
    expect(nextAnnouncement([ev('09:00'), ev('11:00', true)], now)).toBeNull();
    expect(nextAnnouncement([], now)).toBeNull();
  });

  it('libellés', () => {
    expect(countdownLabel(18)).toBe('dans 18 min');
    expect(countdownLabel(65)).toBe('dans 1 h 05');
    expect(countdownLabel(0)).toBe('maintenant');
  });
});

describe('closeKind', () => {
  it('TP, SL, Manuel', () => {
    expect(closeKind({ side: 'LONG', exit: 110, stopLoss: 90, takeProfit: 110 })).toBe('TP');
    expect(closeKind({ side: 'SHORT', exit: 5908, stopLoss: 5908, takeProfit: 5890 })).toBe('SL');
    expect(closeKind({ side: 'LONG', exit: 100, stopLoss: null, takeProfit: null })).toBe('Manuel');
  });
});
