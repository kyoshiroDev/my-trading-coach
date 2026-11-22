import { afterEach, describe, it, expect, vi } from 'vitest';
import { TradovateApiClient } from './tradovate-api.client';
import { TradovateConnectionService } from './tradovate-connection.service';
import { signOAuthState } from './oauth-state.util';

/**
 * #1004 (S4 de #994) : au callback, le `state` renvoyé par Tradovate est obligatoire et doit
 * égaler le cookie avant tout échange de code. Constaté en prod le 22/11 : Tradovate le renvoie.
 * Chemins courts uniquement : Prisma et `fetch` ne doivent jamais être appelés.
 */
describe('Callback Tradovate — state obligatoire (#1004)', () => {
  const SECRET = 'secret-de-test';
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    const env: Record<string, string> = { JWT_SECRET: SECRET };
    const config = { get: (k: string) => env[k] };
    const findFirst = vi.fn();
    const prisma = { tradingAccount: { findFirst } };
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const service = new TradovateConnectionService(
      prisma as never,
      new TradovateApiClient(config as never),
      config as never,
      { client: {} } as never,
    );
    const cookie = signOAuthState({ userId: 'u1', accountId: 'a1', origin: 'settings' }, SECRET);
    return { service, cookie, findFirst, fetchSpy };
  }

  it('code sans state → refusé (state_mismatch), aucun échange de code', async () => {
    const { service, cookie, findFirst, fetchSpy } = setup();
    await expect(service.completeAuthorization({ code: 'CODE-TIERS' }, cookie)).resolves.toMatchObject({
      status: 'error',
      reason: 'state_mismatch',
      accountId: 'a1',
      origin: 'settings',
    });
    expect(findFirst).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('state différent du cookie → refusé', async () => {
    const { service, cookie, fetchSpy } = setup();
    await expect(service.completeAuthorization({ code: 'CODE', state: 'autre' }, cookie)).resolves.toMatchObject({
      reason: 'state_mismatch',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refus chez Tradovate sans state → message de refus (rien échangé)', async () => {
    const { service, cookie, fetchSpy } = setup();
    await expect(service.completeAuthorization({ error: 'access_denied' }, cookie)).resolves.toMatchObject({
      reason: 'denied',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('state identique au cookie → passe le contrôle (poursuit vers le compte)', async () => {
    const { service, cookie, findFirst } = setup();
    findFirst.mockResolvedValue(null);
    await expect(service.completeAuthorization({ code: 'CODE', state: cookie }, cookie)).resolves.toMatchObject({
      reason: 'account_not_found',
    });
    expect(findFirst).toHaveBeenCalledOnce();
  });
});
