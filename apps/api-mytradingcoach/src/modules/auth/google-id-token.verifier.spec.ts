import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { GoogleIdTokenVerifier, GoogleTokenRefusedException } from './google-id-token.verifier';

// Vraie vérification de la lib (signature RS256, aud, iss, exp) : seuls les certificats publics
// de Google sont remplacés par une clé de test, aucun appel réseau.
const CLIENT_ID = 'mtc-test.apps.googleusercontent.com';
const KID = 'test-kid';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: otherKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

const b64url = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');

function idToken(claims: Record<string, unknown> = {}, key = privateKey): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: 'RS256', typ: 'JWT', kid: KID });
  const payload = b64url({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '1234567890',
    email: 'Trader@Gmail.com',
    email_verified: true,
    name: 'Trader Test',
    iat: now,
    exp: now + 3600,
    ...claims,
  });
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

describe('GoogleIdTokenVerifier', () => {
  const verifier = new GoogleIdTokenVerifier();

  beforeAll(() => {
    vi.spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync').mockResolvedValue({
      certs: { [KID]: publicKey.export({ type: 'spki', format: 'pem' }).toString() },
      format: 'PEM',
    } as never);
  });

  it('jeton valide → identité, e-mail en minuscules', async () => {
    await expect(verifier.verify(idToken(), CLIENT_ID)).resolves.toEqual({
      googleId: '1234567890',
      email: 'trader@gmail.com',
      name: 'Trader Test',
    });
  });

  it('signature d’une autre clé → refus', async () => {
    await expect(verifier.verify(idToken({}, otherKey), CLIENT_ID)).rejects.toMatchObject({ reason: 'invalid_token' });
  });

  it('mauvais aud (client d’un autre environnement) → refus', async () => {
    await expect(
      verifier.verify(idToken({ aud: 'autre-env.apps.googleusercontent.com' }), CLIENT_ID),
    ).rejects.toMatchObject({ reason: 'invalid_token' });
  });

  it('jeton expiré → refus', async () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    await expect(verifier.verify(idToken({ iat: past - 3600, exp: past }), CLIENT_ID)).rejects.toMatchObject({
      reason: 'invalid_token',
    });
  });

  it('émetteur autre que Google → refus', async () => {
    await expect(verifier.verify(idToken({ iss: 'https://evil.example.com' }), CLIENT_ID)).rejects.toBeInstanceOf(
      GoogleTokenRefusedException,
    );
  });

  it('e-mail non vérifié chez Google → refus dédié', async () => {
    await expect(verifier.verify(idToken({ email_verified: false }), CLIENT_ID)).rejects.toMatchObject({
      reason: 'email_not_verified',
    });
  });

  it('jeton illisible → refus, sans relayer le message de la lib', async () => {
    const err = await verifier.verify('pas-un-jeton-pas-un-jeton', CLIENT_ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleTokenRefusedException);
    expect((err as GoogleTokenRefusedException).getResponse()).toMatchObject({ code: 'GOOGLE_TOKEN_INVALID' });
  });
});
