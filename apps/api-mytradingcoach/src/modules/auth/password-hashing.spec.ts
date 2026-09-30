import { describe, it, expect } from 'vitest';
import * as argon2 from 'argon2';
import { ARGON2_OPTIONS, hashPassword, needsPasswordRehash } from './password-hashing';

// Vrai argon2 (pas de mock) : on vérifie les hashs réellement produits.
describe('password-hashing — argon2 aux paramètres OWASP', () => {
  it('un nouveau hash est en argon2id, 19 Mio, 2 passes, 1 thread', async () => {
    const hash = await hashPassword('mot-de-passe');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await argon2.verify(hash, 'mot-de-passe')).toBe(true);
    expect(needsPasswordRehash(hash)).toBe(false);
  });

  it('un hash ancien (défauts de la lib, 64 Mio) se vérifie toujours et est signalé à remplacer', async () => {
    const ancien = await argon2.hash('mot-de-passe'); // paramètres d'avant la correction
    expect(ancien).toMatch(/m=65536/);
    expect(await argon2.verify(ancien, 'mot-de-passe')).toBe(true);
    expect(needsPasswordRehash(ancien)).toBe(true);
  });

  it('hash illisible : jamais signalé à remplacer (pas d’écriture à l’aveugle)', () => {
    expect(needsPasswordRehash('pas-un-hash')).toBe(false);
  });

  it('les options sont celles attendues', () => {
    expect(ARGON2_OPTIONS).toEqual({ type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  });
});
