import { describe, it, expect, vi, afterEach } from 'vitest';
import { BALANCE_REFRESH_MIN_MS, TradovateBalanceService } from './tradovate-balance.service';
import { TradovateApiClient } from './tradovate-api.client';
import { TradovateApiError } from './tradovate.errors';

/**
 * Solde et equity lus chez le broker. Verrouille : l'instantané n'est lu que sur demande et
 * bridé (jamais en boucle), un échec ne casse rien, et l'equity d'un compte sans position est
 * son solde réalisé, poussé par le WebSocket.
 */

const conn = (over: Record<string, unknown> = {}) => ({
  id: 'bc-1', accountId: 'acc-1', status: 'CONNECTED', externalAccountId: '777', externalEnv: 'demo',
  brokerCashBalance: null, brokerCashBalanceAt: null, brokerNetLiq: null, brokerOpenPnl: null,
  brokerEquityAt: null, brokerOpenPositions: 0, ...over,
});

function setup(stored = conn()) {
  let row = { ...stored } as Record<string, unknown>;
  const prisma = {
    brokerConnection: {
      findUnique: vi.fn(async () => row),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (row = { ...row, ...data })),
    },
  };
  const api = { postRead: vi.fn(async () => ({ totalCashValue: 50_200, netLiq: 49_950, openPnL: -250 })) };
  const connections = {
    getConnection: vi.fn(async () => row),
    getSession: vi.fn(async () => ({ token: 'AT', apiHosts: { demo: 'demo.example' } })),
  };
  const service = new TradovateBalanceService(prisma as never, api as never, connections as never);
  return { service, prisma, api, connections };
}

describe('TradovateBalanceService', () => {
  afterEach(() => vi.useRealTimers());

  it('instantané : compte broker en entier, route de lecture ; equity, latent et solde persistés', async () => {
    const { service, api, prisma } = setup();
    const view = await service.captureSnapshot(conn() as never, 'AT', null, 1);
    expect(api.postRead).toHaveBeenCalledWith('demo', '/cashBalance/getcashbalancesnapshot', 'AT', { accountId: 777 }, null);
    expect(view).toMatchObject({ accountId: 'acc-1', cashBalance: 50_200, netLiq: 49_950, openPnl: -250, openPositions: 1 });
    expect(prisma.brokerConnection.update.mock.calls[0][0].data.brokerEquityAt).toBeInstanceOf(Date);
  });

  it('instantané en échec (broker indisponible) : null, rien d\'écrit, la synchro continue', async () => {
    const { service, api, prisma } = setup();
    api.postRead.mockRejectedValueOnce(new TradovateApiError('unavailable', 503, 'x'));
    expect(await service.captureSnapshot(conn() as never, 'AT', null)).toBeNull();
    expect(prisma.brokerConnection.update).not.toHaveBeenCalled();
  });

  it('solde poussé, aucune position ouverte : l\'equity EST le solde (latent nul)', async () => {
    const { service } = setup();
    const at = new Date('2026-10-03T15:00:00Z');
    expect(await service.recordCashBalance('bc-1', 50_400, at))
      .toMatchObject({ cashBalance: 50_400, netLiq: 50_400, openPnl: 0, equityAt: at });
  });

  it('solde poussé, position ouverte : l\'equity reste celle du dernier instantané (latent inconnu)', async () => {
    const { service } = setup(conn({ brokerOpenPositions: 1, brokerNetLiq: 49_000, brokerOpenPnl: -900 }));
    expect(await service.recordCashBalance('bc-1', 49_900, new Date()))
      .toMatchObject({ cashBalance: 49_900, netLiq: 49_000, openPnl: -900 });
  });

  it('événement plus ancien que la valeur stockée (rejeu à la reconnexion) : ignoré', async () => {
    const { service, prisma } = setup(conn({ brokerCashBalance: 50_000, brokerCashBalanceAt: new Date('2026-10-03T16:00:00Z') }));
    const view = await service.recordCashBalance('bc-1', 1, new Date('2026-10-03T15:00:00Z'));
    expect(view?.cashBalance).toBe(50_000);
    expect(prisma.brokerConnection.update).not.toHaveBeenCalled();
  });

  it('rafraîchissement bridé : instantané de moins de 20 s → aucun appel au broker', async () => {
    const { service, api } = setup(conn({ brokerEquityAt: new Date(Date.now() - BALANCE_REFRESH_MIN_MS + 1_000) }));
    await service.refresh('u1', 'acc-1');
    expect(api.postRead).not.toHaveBeenCalled();
  });

  it('rafraîchissement : instantané ancien → relu avec le jeton et les hôtes de la connexion', async () => {
    const { service, api } = setup(conn({ brokerEquityAt: new Date(Date.now() - BALANCE_REFRESH_MIN_MS - 1) }));
    const view = await service.refresh('u1', 'acc-1');
    expect(api.postRead).toHaveBeenCalledWith('demo', '/cashBalance/getcashbalancesnapshot', 'AT', { accountId: 777 }, { demo: 'demo.example' });
    expect(view.netLiq).toBe(49_950);
  });

  it('rafraîchissement sans jeton (à reconnecter, compte démo) : dernière valeur connue, jamais d\'erreur', async () => {
    const { service, api, connections } = setup(conn({ brokerCashBalance: 50_000 }));
    connections.getSession.mockRejectedValueOnce(new Error('placeholder'));
    expect((await service.refresh('u1', 'acc-1')).cashBalance).toBe(50_000);
    expect(api.postRead).not.toHaveBeenCalled();
  });
});

describe('TradovateApiClient.postRead — lecture seule', () => {
  afterEach(() => vi.restoreAllMocks());

  it('route hors liste blanche : refusée AVANT tout appel réseau', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = new TradovateApiClient({ get: () => undefined } as never);
    await expect(client.postRead('demo', '/order/placeorder' as never, 'AT', {})).rejects.toThrow(/non autorisée/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('route autorisée : POST JSON avec le jeton, `errorText` traduit en erreur', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"errorText":"Access is denied"}', { status: 200 }));
    const client = new TradovateApiClient({ get: () => undefined } as never);
    await expect(client.postRead('demo', '/cashBalance/getcashbalancesnapshot', 'AT', { accountId: 1 })).rejects.toBeInstanceOf(TradovateApiError);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/cashBalance\/getcashbalancesnapshot$/);
    expect(init).toMatchObject({ method: 'POST', body: '{"accountId":1}' });
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer AT');
  });
});
