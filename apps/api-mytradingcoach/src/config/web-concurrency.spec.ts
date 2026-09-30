import { describe, it, expect } from 'vitest';
import { webConcurrency } from './web-concurrency';

describe('webConcurrency — workers du cluster bornés', () => {
  it('sans variable : au plus 3, même sur 8 cœurs (8 workers saturaient 1 Gio au repos)', () => {
    expect(webConcurrency(undefined, 8)).toBe(3);
    expect(webConcurrency(undefined, 4)).toBe(3);
  });

  it('machine plus petite : un worker par cœur, au moins 1', () => {
    expect(webConcurrency(undefined, 2)).toBe(2);
    expect(webConcurrency(undefined, 0)).toBe(1);
  });

  it('WEB_CONCURRENCY explicite : respecté, y compris au-delà de 3', () => {
    expect(webConcurrency('2', 4)).toBe(2);
    expect(webConcurrency('6', 8)).toBe(6);
  });

  it('valeur invalide : retombe sur le défaut', () => {
    expect(webConcurrency('0', 4)).toBe(3);
    expect(webConcurrency('abc', 4)).toBe(3);
  });
});
