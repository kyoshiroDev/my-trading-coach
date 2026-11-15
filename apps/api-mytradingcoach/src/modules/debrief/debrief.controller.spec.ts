import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { DebriefController } from './debrief.controller';

describe('DebriefController', () => {
  it('PDF du débrief : 5 par minute au plus (S3 #1045)', () => {
    const handler = DebriefController.prototype.exportPDF;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(5);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
  });
});
