import { randomBytes } from 'node:crypto';
import { decryptToken, encryptToken, loadTokenKey } from './token-cipher.util';

describe('token-cipher.util', () => {
  const key = randomBytes(32);

  it('chiffre puis déchiffre à l’identique', () => {
    const token = 'eyJraWQiOiI1.access.token';
    expect(decryptToken(encryptToken(token, key), key)).toBe(token);
  });

  it('ne stocke jamais le token en clair et varie à chaque chiffrement (IV aléatoire)', () => {
    const token = 'refresh-token-secret';
    const a = encryptToken(token, key);
    const b = encryptToken(token, key);
    expect(a).not.toContain(token);
    expect(a).not.toBe(b);
    expect(a.startsWith('v1:')).toBe(true);
  });

  it('refuse un chiffré altéré (intégrité GCM)', () => {
    const [v, iv, tag, ct] = encryptToken('abc', key).split(':');
    const flipped = Buffer.from(ct, 'base64');
    flipped[0] ^= 0xff;
    expect(() => decryptToken([v, iv, tag, flipped.toString('base64')].join(':'), key)).toThrow();
  });

  it('refuse une autre clé', () => {
    expect(() => decryptToken(encryptToken('abc', key), randomBytes(32))).toThrow();
  });

  it('valide la clé : absente ou de mauvaise taille → erreur explicite', () => {
    expect(() => loadTokenKey(undefined)).toThrow(/manquante/);
    expect(() => loadTokenKey(randomBytes(16).toString('base64'))).toThrow(/32 octets/);
    expect(loadTokenKey(key.toString('base64')).equals(key)).toBe(true);
  });
});
