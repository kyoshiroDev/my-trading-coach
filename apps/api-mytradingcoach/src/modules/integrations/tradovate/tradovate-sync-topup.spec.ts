import { BrokerConnection, BrokerConnectionStatus, BrokerProvider } from '@prisma/client';
import { TradovateSyncService } from './tradovate-sync.service';

/**
 * Rattrapage du mois en cours, greffé à la fin de la synchro.
 *
 * Le point sensible : la synchro qui vient de tourner a pu RENOUVELER les tokens, et l'objet
 * `conn` chargé en début de méthode porte encore l'ancienne échéance. Le repasser tel quel au
 * rattrapage ferait croire à un token expiré et déclencherait une seconde rotation dans la
 * foulée — inutile, et une occasion de plus de se faire refuser par Tradovate.
 */
function conn(overrides: Partial<BrokerConnection> = {}): BrokerConnection {
  return {
    id: 'c1',
    userId: 'u1',
    accountId: 'compte-mtc',
    provider: BrokerProvider.TRADOVATE,
    status: BrokerConnectionStatus.CONNECTED,
    externalAccountId: '65772261',
    externalEnv: 'demo',
    accessTokenExpiresAt: new Date(Date.now() - 60_000), // périmé DANS L'OBJET en mémoire
    ...overrides,
  } as BrokerConnection;
}

function setup(relu: BrokerConnection | null) {
  const prisma = { brokerConnection: { findUnique: vi.fn().mockResolvedValue(relu) } };
  const history = { importHistory: vi.fn().mockResolvedValue({ created: 3 }) };
  const service = new TradovateSyncService(
    prisma as never, {} as never, {} as never, history as never, {} as never, {} as never, {} as never, {} as never,
  );
  // `topUpCurrentMonth` est privée : c'est le comportement qu'on verrouille, pas la signature.
  const topUp = (c: BrokerConnection) =>
    (service as unknown as {
      topUpCurrentMonth: (u: string, c: BrokerConnection) => Promise<number>;
    }).topUpCurrentMonth('u1', c);
  return { topUp, prisma, history };
}

describe('Synchro Tradovate — rattrapage du mois en cours', () => {
  it('relit la connexion en base plutôt que de réutiliser l’objet périmé', async () => {
    const frais = conn({ accessTokenExpiresAt: new Date(Date.now() + 75 * 60_000) });
    const { topUp, prisma, history } = setup(frais);

    const created = await topUp(conn());

    expect(created).toBe(3);
    expect(prisma.brokerConnection.findUnique).toHaveBeenCalledWith({ where: { id: 'c1' } });
    // C'est la version RELUE qui part au rattrapage, avec son token frais.
    expect(history.importHistory).toHaveBeenCalledWith('u1', frais, { months: 1 });
  });

  it('connexion devenue « à reconnecter » pendant la synchro → aucun rattrapage', async () => {
    const { topUp, history } = setup(conn({ status: BrokerConnectionStatus.NEEDS_RECONNECT }));
    await expect(topUp(conn())).resolves.toBe(0);
    expect(history.importHistory).not.toHaveBeenCalled();
  });

  it('connexion supprimée entre-temps → aucun rattrapage, aucune erreur', async () => {
    const { topUp, history } = setup(null);
    await expect(topUp(conn())).resolves.toBe(0);
    expect(history.importHistory).not.toHaveBeenCalled();
  });

  it('un rattrapage en échec ne fait jamais échouer la synchro', async () => {
    const { topUp, history } = setup(conn());
    history.importHistory.mockRejectedValue(new Error('Tradovate injoignable'));
    await expect(topUp(conn())).resolves.toBe(0);
  });
});
