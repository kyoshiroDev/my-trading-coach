import { describe, it, expect } from 'vitest';
import { PnlFormatPipe } from './pnl-format.pipe';

describe('PnlFormatPipe', () => {
  const pipe = new PnlFormatPipe();

  it('pnl > 0 → +$X,XXX.XX', () => {
    expect(pipe.transform(5000)).toBe('+$5,000.00');
  });

  it('pnl < 0 → -$X.XX', () => {
    expect(pipe.transform(-340)).toBe('-$340.00');
  });

  it('pnl = 0 → +$0.00', () => {
    expect(pipe.transform(0)).toBe('+$0.00');
  });

  it('pnl = null → —', () => {
    expect(pipe.transform(null)).toBe('—');
  });

  it('pnl = undefined → —', () => {
    expect(pipe.transform(undefined)).toBe('—');
  });

  it('pnl > 0 avec entry → affiche le pourcentage', () => {
    const result = pipe.transform(5000, 60000);
    expect(result).toContain('+$5,000.00');
    expect(result).toContain('%');
  });

  it('pnl < 0 avec entry → affiche le pourcentage négatif', () => {
    const result = pipe.transform(-340, 4080);
    expect(result).toContain('-$340.00');
    expect(result).toContain('-');
    expect(result).toContain('%');
  });
});
