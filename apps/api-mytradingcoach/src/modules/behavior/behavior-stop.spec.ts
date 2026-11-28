import { describe, it, expect } from 'vitest';
import { stopWidenedDraft, stopWidening } from './behavior-stop';

// NQ : tick 0,25. Entrée LONG à 21 500 ; SHORT à 21 500.
const T = 0.25;
const long = (prevStop: number, nextStop: number) => stopWidening({ side: 'LONG', entryPrice: 21_500, prevStop, nextStop, tickSize: T });
const short = (prevStop: number, nextStop: number) => stopWidening({ side: 'SHORT', entryPrice: 21_500, prevStop, nextStop, tickSize: T });

describe('E1 stop éloigné (#672)', () => {
  it('LONG : stop abaissé sous l’entrée → écart et risque en ticks', () => {
    expect(long(21_498, 21_496.5)).toEqual({ widenedTicks: 6, riskTicks: 14 });
  });

  it('SHORT : stop remonté au-dessus de l’entrée', () => {
    expect(short(21_502, 21_503.5)).toEqual({ widenedTicks: 6, riskTicks: 14 });
  });

  it('rapprocher le stop (protéger) ne déclenche rien', () => {
    expect(long(21_496, 21_498)).toBeNull();
    expect(short(21_504, 21_502)).toBeNull();
  });

  it('stop qui reste du côté gain (suiveur qui recule) : rien', () => {
    expect(long(21_510, 21_505)).toBeNull();
    expect(long(21_505, 21_500)).toBeNull(); // ramené à l'entrée : aucune perte possible
  });

  it('ancien stop côté gain qui repasse côté perte : le risque augmente', () => {
    expect(long(21_500.5, 21_499)).toEqual({ widenedTicks: 6, riskTicks: 4 });
  });

  it('en dessous du seuil (1 tick) : rien ; à 2 ticks : alerte', () => {
    expect(long(21_498, 21_497.75)).toBeNull();
    expect(long(21_498, 21_497.5)).toEqual({ widenedTicks: 2, riskTicks: 10 });
  });

  it('taille de tick inconnue ou prix illisible : rien', () => {
    expect(stopWidening({ side: 'LONG', entryPrice: 21_500, prevStop: 21_498, nextStop: 21_490, tickSize: 0 })).toBeNull();
    expect(stopWidening({ side: 'LONG', entryPrice: Number.NaN, prevStop: 21_498, nextStop: 21_490, tickSize: T })).toBeNull();
  });

  it('message factuel, sans conseil ni tiret cadratin', () => {
    const d = stopWidenedDraft('NQ', { widenedTicks: 6, riskTicks: 14 }, { side: 'LONG' });
    expect(d).toMatchObject({ type: 'E1_STOP_WIDENED', severity: 'medium', message: 'Stop éloigné de 6 ticks sur NQ (risque porté à 14 ticks).' });
    expect(d.message).not.toMatch(/—/);
    expect(d.context).toMatchObject({ side: 'LONG', widenedTicks: 6, riskTicks: 14 });
  });
});
