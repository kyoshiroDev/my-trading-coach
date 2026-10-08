import { describe, it, expect } from 'vitest';
import { SOCKET_RECONNECT_OPTIONS as o } from './socket-reconnect';

/** Bornes du délai de l'essai n, avec la formule de socket.io-client (contrib/backo2). */
function bounds(attempt: number): [number, number] {
  const ms = o.reconnectionDelay! * 2 ** attempt;
  const dev = o.randomizationFactor! * ms;
  return [Math.min(ms - dev, o.reconnectionDelayMax!), Math.min(ms + dev, o.reconnectionDelayMax!)];
}

describe('SOCKET_RECONNECT_OPTIONS (SCA-B4-07)', () => {
  it('1er essai étalé entre 1 et 9 s : les onglets ne reviennent plus tous ensemble', () => {
    expect(bounds(0)).toEqual([1_000, 9_000]);
  });

  it('jamais plus de 60 s entre deux essais', () => {
    expect(bounds(10)[1]).toBe(60_000);
  });
});
