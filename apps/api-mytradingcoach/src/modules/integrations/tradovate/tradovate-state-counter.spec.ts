import { describe, it, expect, vi } from 'vitest';
import { TradovateApiClient } from './tradovate-api.client';
import { TRADOVATE_STATE_COUNTER_KEY, TradovateConnectionService } from './tradovate-connection.service';
import { signOAuthState } from './oauth-state.util';

/**
 * #1004 : au callback, chaque retour avec un cookie valide incrémente un compteur Redis durable
 * selon que Tradovate a renvoyé `state` ou non (le log seul est effacé à chaque déploiement).
 * Chemins courts (refus de l'utilisateur, state différent) : aucun appel Tradovate ni base.
 */
describe('Callback Tradovate — compteur du state renvoyé (#1004)', () => {
  const SECRET = 'secret-de-test';

  function setup(incr = vi.fn().mockResolvedValue(1)) {
    const env: Record<string, string> = { JWT_SECRET: SECRET };
    const config = { get: (k: string) => env[k] };
    const redis = { client: { incr } };
    const api = new TradovateApiClient(config as never);
    const service = new TradovateConnectionService({} as never, api, config as never, redis as never);
    const cookie = signOAuthState({ userId: 'u1', accountId: 'a1', origin: 'settings' }, SECRET);
    return { service, incr, cookie };
  }

  it('state renvoyé → compteur « oui »', async () => {
    const { service, incr, cookie } = setup();
    await expect(service.completeAuthorization({ state: cookie, error: 'access_denied' }, cookie)).resolves.toMatchObject({
      status: 'error',
      reason: 'denied',
    });
    expect(incr).toHaveBeenCalledExactlyOnceWith(`${TRADOVATE_STATE_COUNTER_KEY}:oui`);
  });

  it('state absent → compteur « non »', async () => {
    const { service, incr, cookie } = setup();
    await service.completeAuthorization({ error: 'access_denied' }, cookie);
    expect(incr).toHaveBeenCalledExactlyOnceWith(`${TRADOVATE_STATE_COUNTER_KEY}:non`);
  });

  it('cookie absent ou invalide → rien compté (retour qui ne vient pas de MTC)', async () => {
    const { service, incr } = setup();
    await expect(service.completeAuthorization({ state: 'x', code: 'c' }, undefined)).resolves.toMatchObject({
      reason: 'session_expired',
    });
    expect(incr).not.toHaveBeenCalled();
  });

  it('cookie signé avec un autre secret → rien compté', async () => {
    const { service, incr } = setup();
    const forge = signOAuthState({ userId: 'u1', accountId: 'a1', origin: 'settings' }, 'autre-secret');
    await expect(service.completeAuthorization({ state: forge, error: 'access_denied' }, forge)).resolves.toMatchObject({
      reason: 'session_expired',
    });
    expect(incr).not.toHaveBeenCalled();
  });

  it('Redis en panne → le callback rend le même résultat, sans lever', async () => {
    const incr = vi.fn().mockRejectedValue(new Error('redis down'));
    const { service, cookie } = setup(incr);
    await expect(service.completeAuthorization({ state: 'autre', code: 'c' }, cookie)).resolves.toMatchObject({
      status: 'error',
      reason: 'state_mismatch',
      accountId: 'a1',
    });
    expect(incr).toHaveBeenCalledOnce();
  });
});
