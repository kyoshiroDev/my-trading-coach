import { signOAuthState, verifyOAuthState } from './oauth-state.util';

describe('oauth-state.util', () => {
  const secret = 'jwt-secret-de-test';
  const payload = { userId: 'user_1', accountId: 'acc_1' };

  it('vérifie un state qu’il a signé (user + compte restitués)', () => {
    expect(verifyOAuthState(signOAuthState(payload, secret), secret)).toEqual(payload);
  });

  it('refuse un state expiré (10 min)', () => {
    const t0 = 1_000_000;
    const state = signOAuthState(payload, secret, t0);
    expect(verifyOAuthState(state, secret, t0 + 9 * 60_000)).toEqual(payload);
    expect(verifyOAuthState(state, secret, t0 + 11 * 60_000)).toBeNull();
  });

  it('refuse un payload modifié (autre compte cible)', () => {
    const [, sig] = signOAuthState(payload, secret).split('.');
    const forged = Buffer.from(
      JSON.stringify({ u: 'user_1', a: 'acc_VICTIME', n: 'x', exp: Date.now() + 60_000 }),
    ).toString('base64url');
    expect(verifyOAuthState(`${forged}.${sig}`, secret)).toBeNull();
  });

  it('refuse une autre clé, un format invalide, une absence', () => {
    expect(verifyOAuthState(signOAuthState(payload, secret), 'autre-secret')).toBeNull();
    expect(verifyOAuthState('pas-un-state', secret)).toBeNull();
    expect(verifyOAuthState(undefined, secret)).toBeNull();
  });

  it('n’est pas un JWT (inutilisable comme Bearer sur l’API)', () => {
    expect(signOAuthState(payload, secret).split('.')).toHaveLength(2);
  });
});
