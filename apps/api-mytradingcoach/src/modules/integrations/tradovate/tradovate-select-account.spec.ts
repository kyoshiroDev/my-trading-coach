import { randomBytes } from 'node:crypto';
import { BrokerConnection, BrokerConnectionStatus, BrokerProvider } from '@prisma/client';
import { encryptToken } from '@api/common/utils/token-cipher.util';
import { TradovateConnectionService } from './tradovate-connection.service';

/**
 * Audit fonctionnel #994 (N7) : changer de compte Tradovate sur une connexion existante (compte broker
 * détaché, autre login) gardait l'état de l'ANCIEN compte : `historyImportedAt` déjà posé, donc
 * l'historique du nouveau n'était jamais importé ; payouts relus après la dernière date de l'ancien ;
 * solde et equity de l'ancien affichés jusqu'à la synchro suivante.
 */
describe('Choix d’un autre compte Tradovate sur une connexion existante', () => {
  const key = randomBytes(32);
  const config = {
    get: (k: string) => ({ BROKER_TOKEN_ENCRYPTION_KEY: key.toString('base64'), JWT_SECRET: 's' })[k],
  };

  function setup(externalAccountId: string | null) {
    const conn = {
      id: 'c1', userId: 'u1', accountId: 'a1',
      provider: BrokerProvider.TRADOVATE, status: BrokerConnectionStatus.CONNECTED,
      accessTokenEnc: encryptToken('AT-1', key), refreshTokenEnc: encryptToken('RT-1', key),
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000), refreshTokenExpiresAt: null,
      externalUserId: '9100001', externalAccountId,
      historyImportedAt: new Date('2026-10-01'), payoutsCheckedThrough: new Date('2026-10-31'),
      brokerCashBalance: 50_000, brokerNetLiq: 50_100, brokerOpenPnl: 100, brokerOpenPositions: 1,
      availableAccounts: [
        { id: '90000010', name: 'ANCIEN', env: 'demo', userId: '699523' },
        { id: '90000011', name: 'NOUVEAU', env: 'demo', userId: '699523' },
      ],
    } as unknown as BrokerConnection;
    const prisma = {
      trade: { groupBy: vi.fn().mockResolvedValue([]) },
      brokerConnection: {
        findFirst: vi.fn().mockResolvedValue(conn),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({ ...conn }),
      },
      tradingAccount: { update: vi.fn().mockResolvedValue({}) },
    };
    const service = new TradovateConnectionService(
      prisma as never,
      { get: vi.fn().mockResolvedValue([]) } as never,
      config as never,
      { client: { set: vi.fn().mockResolvedValue('OK'), del: vi.fn() } } as never,
    );
    const data = () => prisma.brokerConnection.update.mock.calls[0][0].data as Record<string, unknown>;
    return { service, data };
  }

  it('autre compte broker → historique, payouts et solde de l’ancien effacés (import complet relancé)', async () => {
    const { service, data } = setup('90000010');
    await service.selectAccount('u1', 'a1', '90000011');
    expect(data()).toMatchObject({
      externalAccountId: '90000011',
      historyImportedAt: null,
      payoutsCheckedThrough: null,
      brokerCashBalance: null,
      brokerNetLiq: null,
      brokerOpenPnl: null,
      brokerOpenPositions: 0,
    });
  });

  it('même compte re-choisi → rien n’est effacé', async () => {
    const { service, data } = setup('90000011');
    await service.selectAccount('u1', 'a1', '90000011');
    expect(data()).not.toHaveProperty('historyImportedAt');
  });

  it('premier choix (aucun compte encore) → rien à effacer', async () => {
    const { service, data } = setup(null);
    await service.selectAccount('u1', 'a1', '90000011');
    expect(data()).not.toHaveProperty('historyImportedAt');
  });
});
