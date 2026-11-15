import { describe, it, expect } from 'vitest';
import { backupStamp } from './backup-stamp';

describe('backupStamp', () => {
  it('AAAAMMJJ-HHMM en UTC', () => {
    expect(backupStamp(new Date('2026-11-14T07:05:59Z'))).toBe('20261114-0705');
  });
});
