import { describe, it, expect } from 'vitest';
import { UNASSIGNED, accountKeys, tradesByKey } from './debrief-account-keys';

/** Débrief : comptes désignés à l'IA par compte-1, compte-2…, jamais par leur id interne. */
describe('accountKeys', () => {
  it("clés dans l'ordre des comptes, aller-retour exact, unassigned inchangé", () => {
    const keys = accountKeys(['cuid-a', 'cuid-b']);
    expect(keys.toKey('cuid-a')).toBe('compte-1');
    expect(keys.toKey('cuid-b')).toBe('compte-2');
    expect(keys.toId('compte-2')).toBe('cuid-b');
    expect(keys.toKey(UNASSIGNED)).toBe(UNASSIGNED);
    expect(keys.toId(UNASSIGNED)).toBe(UNASSIGNED);
  });

  it('clé inconnue renvoyée par le modèle : null (analyse ignorée)', () => {
    const keys = accountKeys(['cuid-a']);
    expect(keys.toId('compte-9')).toBeNull();
    expect(keys.toId('cuid-a')).toBeNull(); // un id brut n'est pas une clé
  });

  it('id hors de la liste des comptes : nouvelle clé, jamais l’id lui-même', () => {
    const keys = accountKeys(['cuid-a']);
    expect(keys.toKey('cuid-z')).toBe('compte-2');
    expect(keys.toId('compte-2')).toBe('cuid-z');
  });
});

describe('tradesByKey', () => {
  it('regroupe par clé et retire accountId de chaque trade', () => {
    const keys = accountKeys(['cuid-a']);
    const out = tradesByKey(
      { 'cuid-a': [{ asset: 'MNQ', accountId: 'cuid-a' }], [UNASSIGNED]: [{ asset: 'ES', accountId: null }] },
      keys,
    );
    expect(out).toEqual({ 'compte-1': [{ asset: 'MNQ' }], [UNASSIGNED]: [{ asset: 'ES' }] });
    expect(JSON.stringify(out)).not.toContain('cuid-');
  });
});
