import { describe, it, expect } from 'vitest';
import { loadTestKey, loadTestTracker } from './load-test-tracker';

const KEY = 'k'.repeat(40);
const BETA = 'postgresql://u:p@mtc_pgbouncer:6432/mytradingcoach_beta?pgbouncer=true';
const PROD = 'postgresql://u:p@mtc_pgbouncer:6432/mytradingcoach_prod?pgbouncer=true';
const req = (h: Record<string, string>) => ({ headers: h });

describe('loadTestKey — garde-fous', () => {
  it('absente, trop courte ou base de PROD → désactivé', () => {
    expect(loadTestKey({ DATABASE_URL: BETA })).toBeNull();
    expect(loadTestKey({ DATABASE_URL: BETA, LOAD_TEST_KEY: 'court' })).toBeNull();
    expect(loadTestKey({ DATABASE_URL: PROD, LOAD_TEST_KEY: KEY })).toBeNull();
    expect(loadTestKey({ DATABASE_URL: PROD.replace('?pgbouncer=true', ''), LOAD_TEST_KEY: KEY })).toBeNull();
  });

  it('clé longue sur beta → active', () => {
    expect(loadTestKey({ DATABASE_URL: BETA, LOAD_TEST_KEY: KEY })?.toString()).toBe(KEY);
  });
});

describe('loadTestTracker', () => {
  const key = Buffer.from(KEY);

  it('bonne clé + client valide → compteur par client', () => {
    expect(loadTestTracker(req({ 'x-load-test-key': KEY, 'x-load-client': 'vu-42' }), key)).toBe('load:vu-42');
  });

  it('mauvaise clé, clé absente ou client invalide → comptage par IP (null)', () => {
    expect(loadTestTracker(req({ 'x-load-test-key': 'x'.repeat(40), 'x-load-client': 'vu-1' }), key)).toBeNull();
    expect(loadTestTracker(req({ 'x-load-client': 'vu-1' }), key)).toBeNull();
    expect(loadTestTracker(req({ 'x-load-test-key': KEY, 'x-load-client': '../../etc' }), key)).toBeNull();
    expect(loadTestTracker(req({ 'x-load-test-key': KEY, 'x-load-client': 'a'.repeat(65) }), key)).toBeNull();
    expect(loadTestTracker(req({ 'x-load-test-key': KEY }), key)).toBeNull();
  });

  it('fonction désactivée (pas de clé configurée) → toujours null', () => {
    expect(loadTestTracker(req({ 'x-load-test-key': KEY, 'x-load-client': 'vu-1' }), null)).toBeNull();
  });
});
