import { Logger } from '@nestjs/common';
import { TradovateSyncService } from './tradovate-sync.service';

/**
 * Déconnexion avec suppression optionnelle des trades importés. La vraie base (sources
 * épargnées, compte ciblé) est prouvée par `tradovate-sync.int-spec.ts` ; ici l'ordre des
 * étapes et le cas limite : suppression en échec APRÈS une déconnexion réussie.
 */
function setup(removeBrokerImported = vi.fn().mockResolvedValue(4)) {
  const connections = { disconnect: vi.fn().mockResolvedValue({ disconnected: true }) };
  const trades = { removeBrokerImported };
  const service = new TradovateSyncService(
    {} as never, {} as never, connections as never, {} as never, {} as never, trades as never, {} as never,
  );
  return { service, connections, trades };
}

describe('TradovateSyncService.disconnect', () => {
  it('par défaut : déconnecte sans toucher aux trades', async () => {
    const { service, connections, trades } = setup();
    await expect(service.disconnect('u1', 'a1')).resolves.toEqual({ disconnected: true, tradesDeleted: 0 });
    expect(connections.disconnect).toHaveBeenCalledWith('u1', 'a1');
    expect(trades.removeBrokerImported).not.toHaveBeenCalled();
  });

  it('deleteTrades : supprime les trades importés de CE compte après la déconnexion', async () => {
    const { service, connections, trades } = setup();
    await expect(service.disconnect('u1', 'a1', { deleteTrades: true })).resolves.toEqual({
      disconnected: true,
      tradesDeleted: 4,
    });
    expect(trades.removeBrokerImported).toHaveBeenCalledWith('u1', 'a1');
    expect(connections.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
      trades.removeBrokerImported.mock.invocationCallOrder[0],
    );
  });

  it('suppression en échec : la déconnexion reste faite, erreur loguée, tradesDeleted null', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { service } = setup(vi.fn().mockRejectedValue(new Error('base indisponible')));
    await expect(service.disconnect('u1', 'a1', { deleteTrades: true })).resolves.toEqual({
      disconnected: true,
      tradesDeleted: null,
    });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('base indisponible'));
    logged.mockRestore();
  });

  it('pas connecté : l’erreur remonte et aucun trade n’est supprimé', async () => {
    const { service, connections, trades } = setup();
    connections.disconnect.mockRejectedValue(new Error('TRADOVATE_NOT_CONNECTED'));
    await expect(service.disconnect('u1', 'a1', { deleteTrades: true })).rejects.toThrow();
    expect(trades.removeBrokerImported).not.toHaveBeenCalled();
  });
});
