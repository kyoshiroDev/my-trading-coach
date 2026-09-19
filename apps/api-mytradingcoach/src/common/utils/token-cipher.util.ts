import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Chiffrement symétrique des secrets de broker stockés en base (tokens OAuth Tradovate,
 * et demain clés API Binance / Bybit) — PROMPT-207.
 *
 * AES-256-GCM : confidentialité + intégrité (un octet modifié en base fait échouer le
 * déchiffrement au lieu de rendre un token corrompu). IV aléatoire de 12 octets par
 * chiffrement, donc deux chiffrements du même token diffèrent.
 *
 * Format stocké : `v1:<iv>:<tag>:<ciphertext>` (base64). Le préfixe de version permet une
 * rotation de clé ou d'algorithme plus tard sans casser les lignes existantes.
 *
 * Clé : `BROKER_TOKEN_ENCRYPTION_KEY`, 32 octets encodés en base64
 * (`openssl rand -base64 32`). Distincte de JWT_SECRET : une fuite de l'un ne compromet
 * pas l'autre. La perdre rend les connexions illisibles → les users devront se reconnecter
 * (aucune donnée de trade perdue).
 */
const VERSION = 'v1';
const ALGO = 'aes-256-gcm';

export function loadTokenKey(raw: string | undefined): Buffer {
  if (!raw) {
    throw new Error('BROKER_TOKEN_ENCRYPTION_KEY manquante');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('BROKER_TOKEN_ENCRYPTION_KEY doit faire 32 octets (base64)');
  }
  return key;
}

export function encryptToken(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptToken(stored: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = stored.split(':');
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error('Format de token chiffré inconnu');
  }
  const decipher = createDecipheriv(ALGO, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
