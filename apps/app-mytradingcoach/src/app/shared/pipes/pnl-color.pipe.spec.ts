import { describe, it, expect } from 'vitest';
import { PnlColorPipe } from './pnl-color.pipe';

describe('PnlColorPipe', () => {
  const pipe = new PnlColorPipe();

  it('retourne la couleur verte pour valeur positive', () => {
    expect(pipe.transform(100)).toBe('#10b981');
  });

  it('retourne la couleur verte pour valeur positive petite', () => {
    expect(pipe.transform(0.01)).toBe('#10b981');
  });

  it('retourne la couleur rouge pour valeur négative', () => {
    expect(pipe.transform(-50)).toBe('#ef4444');
  });

  it('retourne la couleur rouge pour grande perte', () => {
    expect(pipe.transform(-9999)).toBe('#ef4444');
  });

  it('retourne la couleur neutre pour zéro', () => {
    expect(pipe.transform(0)).toBe('#6b7280');
  });

  it('retourne la couleur neutre pour null', () => {
    expect(pipe.transform(null)).toBe('#6b7280');
  });

  it('retourne la couleur neutre pour undefined', () => {
    expect(pipe.transform(undefined)).toBe('#6b7280');
  });
});
