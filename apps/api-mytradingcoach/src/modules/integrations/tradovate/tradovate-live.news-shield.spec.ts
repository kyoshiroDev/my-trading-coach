import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NEWS_SHIELD_TICK_MS, TradovateLiveGateway, userRoom } from './tradovate-live.gateway';
import { TradovateLiveService } from './tradovate-live.service';

/** Bouclier annonces (#670) : minuteur du gateway et comptes tenus par ce worker. */
describe('bouclier annonces : minuteur du gateway', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  const make = (enabled: boolean) => {
    const owned = [{ userId: 'u1', connectionId: 'c1', accountId: 'a1' }];
    const live = { bindEmitter: vi.fn(), ownedConnections: vi.fn(() => owned) };
    const newsShield = { enabled, tick: vi.fn(async () => 0) };
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const gw = new TradovateLiveGateway({} as never, {} as never, live as never, {} as never, {} as never, {} as never, newsShield as never);
    gw.server = { to } as never;
    return { gw, live, newsShield, emit, to, owned };
  };

  it('allumé : un passage par minute sur les comptes tenus par ce worker, émis dans la room du trader', async () => {
    const { gw, newsShield, emit, to, owned } = make(true);
    gw.afterInit();
    expect(newsShield.tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(NEWS_SHIELD_TICK_MS);
    expect(newsShield.tick).toHaveBeenCalledTimes(1);
    const [, accounts, emitFor] = newsShield.tick.mock.calls[0] as unknown as [Date, typeof owned, (u: string) => (e: string, p: unknown) => void];
    expect(accounts).toBe(owned);
    emitFor('u1')('news:alert', { id: 'x' });
    expect(to).toHaveBeenCalledWith(userRoom('u1'));
    expect(emit).toHaveBeenCalledWith('news:alert', { id: 'x' });
    vi.advanceTimersByTime(NEWS_SHIELD_TICK_MS);
    expect(newsShield.tick).toHaveBeenCalledTimes(2);
    gw.onModuleDestroy();
    vi.advanceTimersByTime(NEWS_SHIELD_TICK_MS * 3);
    expect(newsShield.tick).toHaveBeenCalledTimes(2);
  });

  it('éteint (NEWS_SHIELD_ENABLED absente) : aucun minuteur', () => {
    const { gw, newsShield } = make(false);
    gw.afterInit();
    vi.advanceTimersByTime(NEWS_SHIELD_TICK_MS * 5);
    expect(newsShield.tick).not.toHaveBeenCalled();
  });
});

describe('TradovateLiveService.ownedConnections', () => {
  it('seulement les connexions dont ce worker détient le bail', () => {
    const svc = new TradovateLiveService({} as never, {} as never, {} as never, {} as never, {} as never);
    const users = (svc as unknown as { users: Map<string, { owner: boolean; accounts: Map<string, string> }> }).users;
    users.set('u1', { owner: true, accounts: new Map([['c1', 'a1'], ['c2', 'a2']]) });
    users.set('u2', { owner: false, accounts: new Map([['c3', 'a3']]) });
    expect(svc.ownedConnections()).toEqual([
      { userId: 'u1', connectionId: 'c1', accountId: 'a1' },
      { userId: 'u1', connectionId: 'c2', accountId: 'a2' },
    ]);
  });
});
