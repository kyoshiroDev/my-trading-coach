import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountStatus, AdminPushEvent, BrokerConnection, BrokerConnectionStatus, BrokerProvider } from '@prisma/client';
import { AccountsService } from '../../accounts/accounts.service';
import { TradovateBackgroundRefreshCron } from './tradovate-background-refresh.cron';
import { toConnectionView } from './tradovate-connection.view';
import { noticeReconnectRequired } from './tradovate-reconnect-notice';
import { notSyncPausedWhere, SYNC_PAUSE_GRACE_MS, syncPauseReason } from './tradovate-sync-pause';
import { TradovateTokenRefreshCron } from './tradovate-token-refresh.cron';
import { trackableConnection } from './tradovate-watch.service';

/**
 * Pause de la synchro des comptes perdus (#684) : Échoué ou Archivé depuis plus de 48 h, historique
 * importé. PASSED continue. Jetons renouvelés, bouton manuel possible, reprise au retour en Actif.
 */

const now = new Date('2026-11-02T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const imported = new Date('2026-10-01T00:00:00Z');
const H = 3_600_000;

// Horloge figée sur `now` : le service lit l'heure courante (date du statut, délai de 48 h).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

describe('syncPauseReason', () => {
  it('ACTIVE et PASSED ne sont jamais en pause', () => {
    expect(syncPauseReason({ status: AccountStatus.ACTIVE, statusChangedAt: ago(30 * 24 * H) }, imported, now)).toBeNull();
    expect(syncPauseReason({ status: AccountStatus.PASSED, statusChangedAt: ago(30 * 24 * H) }, imported, now)).toBeNull();
  });

  it('Échoué : synchro à 47 h 59, pause à 48 h pile et au-delà', () => {
    const failed = (ms: number) => ({ status: AccountStatus.FAILED, statusChangedAt: ago(ms) });
    expect(syncPauseReason(failed(SYNC_PAUSE_GRACE_MS - 60_000), imported, now)).toBeNull();
    expect(syncPauseReason(failed(SYNC_PAUSE_GRACE_MS), imported, now)).toBe('FAILED');
    expect(syncPauseReason(failed(SYNC_PAUSE_GRACE_MS + 60_000), imported, now)).toBe('FAILED');
  });

  it('Archivé : même règle, raison ARCHIVED', () => {
    expect(syncPauseReason({ status: AccountStatus.ARCHIVED, statusChangedAt: ago(49 * H) }, imported, now)).toBe('ARCHIVED');
  });

  it('statut sans date (antérieur à la colonne) : délai considéré écoulé', () => {
    expect(syncPauseReason({ status: AccountStatus.FAILED, statusChangedAt: null }, imported, now)).toBe('FAILED');
  });

  it('historique complet pas encore importé : jamais de pause', () => {
    expect(syncPauseReason({ status: AccountStatus.FAILED, statusChangedAt: ago(30 * 24 * H) }, null, now)).toBeNull();
  });

  it('compte inconnu : pas de pause', () => {
    expect(syncPauseReason(null, imported, now)).toBeNull();
  });
});

describe('filtre Prisma', () => {
  it('exclut historique importé ET compte perdu depuis 48 h (ou sans date)', () => {
    expect(notSyncPausedWhere(now)).toEqual({
      NOT: {
        historyImportedAt: { not: null },
        account: {
          status: { in: [AccountStatus.FAILED, AccountStatus.ARCHIVED] },
          OR: [{ statusChangedAt: null }, { statusChangedAt: { lte: ago(SYNC_PAUSE_GRACE_MS) } }],
        },
      },
    });
  });

  it('temps réel et veille : même filtre', () => {
    expect(trackableConnection(now)).toMatchObject({ status: 'CONNECTED', ...notSyncPausedWhere(now) });
  });
});

describe('crons', () => {
  function backgroundCron() {
    const prisma = { brokerConnection: { findMany: vi.fn(async () => []) } };
    const redis = { client: { set: vi.fn(async () => 'OK'), eval: vi.fn(async () => 1) } };
    const cron = new TradovateBackgroundRefreshCron(
      prisma as never, { assertConfigured: vi.fn() } as never, {} as never, {} as never,
      { isLive: vi.fn(async () => false) } as never, redis as never,
    );
    return { cron, prisma };
  }

  it('cron de fond : les connexions en pause sont exclues, au passage horaire comme hors passage', async () => {
    for (const at of ['2026-11-02T12:05:00Z', '2026-11-02T12:22:00Z']) {
      const { cron, prisma } = backgroundCron();
      const t = new Date(at);
      await cron.refreshStale(t);
      const where = (prisma.brokerConnection.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
      expect(where).toMatchObject(notSyncPausedWhere(t));
    }
  });

  it('cron des jetons : aucune exclusion, la connexion d’un compte perdu reste renouvelée', async () => {
    const prisma = { brokerConnection: { findMany: vi.fn(async () => []) } };
    const cron = new TradovateTokenRefreshCron(prisma as never, { assertConfigured: vi.fn() } as never);
    await cron.refreshExpiring(now);
    for (const [args] of prisma.brokerConnection.findMany.mock.calls as unknown as [{ where: Record<string, unknown> }][]) {
      expect(args.where).not.toHaveProperty('NOT');
      expect(args.where).not.toHaveProperty('account');
    }
  });
});

describe('vue', () => {
  const conn = { accountId: 'a1', status: BrokerConnectionStatus.CONNECTED, historyImportedAt: imported, availableAccounts: [] } as unknown as BrokerConnection;

  it('compte perdu depuis plus de 48 h : syncPaused et sa raison', () => {
    expect(toConnectionView(conn, 0, { status: AccountStatus.ARCHIVED, statusChangedAt: ago(72 * H) }, now))
      .toMatchObject({ syncPaused: true, syncPausedReason: 'ARCHIVED', status: 'CONNECTED' });
  });

  it('compte actif, ou compte inconnu de l’appelant : pas de pause', () => {
    expect(toConnectionView(conn, 0, { status: AccountStatus.ACTIVE, statusChangedAt: null }, now)).toMatchObject({ syncPaused: false, syncPausedReason: null });
    expect(toConnectionView(conn, 0)).toMatchObject({ syncPaused: false });
  });
});

describe('push de reconnexion', () => {
  const before = (status: AccountStatus) => ({
    status: BrokerConnectionStatus.CONNECTED, userId: 'u1', accountId: 'a1', user: { isDemo: false }, account: { status },
  });

  it.each([AccountStatus.FAILED, AccountStatus.ARCHIVED])('compte %s : push admin gardé, rien au trader', (status) => {
    const admin = { notify: vi.fn() };
    const trader = { notify: vi.fn() };
    noticeReconnectRequired(before(status), { admin: admin as never, trader: trader as never });
    expect(admin.notify).toHaveBeenCalledWith(AdminPushEvent.TRADOVATE_RECONNECT, expect.anything());
    expect(trader.notify).not.toHaveBeenCalled();
  });

  it.each([AccountStatus.ACTIVE, AccountStatus.PASSED])('compte %s : push au trader comme avant', (status) => {
    const trader = { notify: vi.fn() };
    noticeReconnectRequired(before(status), { trader: trader as never });
    expect(trader.notify).toHaveBeenCalledOnce();
  });
});

describe('comptes : date du statut et reprise', () => {
  function service(account: Record<string, unknown>, conns: { id: string; historyImportedAt: Date | null }[] = []) {
    const prisma = {
      tradingAccount: {
        findUnique: vi.fn(async () => ({ id: 'a1', userId: 'u1', currency: 'USD', propFirmPlanId: null, ...account })),
        update: vi.fn(async () => ({ id: 'a1' })),
        count: vi.fn(async () => 0),
      },
      brokerConnection: { findMany: vi.fn(async () => conns), updateMany: vi.fn(async () => ({ count: conns.length })), count: vi.fn(async () => 0) },
      trade: { count: vi.fn(async () => 3) },
      tradeSession: { count: vi.fn(async () => 0) },
    };
    const svc = new AccountsService(prisma as never);
    vi.spyOn(svc as unknown as { invalidateStats: () => Promise<void> }, 'invalidateStats').mockResolvedValue(undefined);
    return { svc, prisma };
  }
  const premium = { plan: 'PREMIUM', role: 'USER', trialEndsAt: null } as never;
  const dataOf = (prisma: { tradingAccount: { update: ReturnType<typeof vi.fn> } }) =>
    (prisma.tradingAccount.update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;

  it('changement de statut : statusChangedAt posé', async () => {
    const { svc, prisma } = service({ status: AccountStatus.ACTIVE, statusChangedAt: null });
    await svc.update('u1', 'a1', { status: AccountStatus.FAILED } as never, premium);
    expect(dataOf(prisma).statusChangedAt).toBeInstanceOf(Date);
  });

  it('modification sans changement de statut : statusChangedAt intact', async () => {
    const { svc, prisma } = service({ status: AccountStatus.FAILED, statusChangedAt: ago(H) });
    await svc.update('u1', 'a1', { label: 'Renommé', status: AccountStatus.FAILED } as never, premium);
    expect(dataOf(prisma)).not.toHaveProperty('statusChangedAt');
  });

  it('retour en Actif d’un compte en pause : historique complet redemandé', async () => {
    const { svc, prisma } = service(
      { status: AccountStatus.FAILED, statusChangedAt: ago(10 * 24 * H) },
      [{ id: 'c1', historyImportedAt: imported }],
    );
    await svc.update('u1', 'a1', { status: AccountStatus.ACTIVE } as never, premium);
    expect(prisma.brokerConnection.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['c1'] } }, data: { historyImportedAt: null } });
  });

  it('retour en Actif avant les 48 h (pas encore en pause) : rien à rattraper', async () => {
    const { svc, prisma } = service(
      { status: AccountStatus.FAILED, statusChangedAt: ago(H) },
      [{ id: 'c1', historyImportedAt: imported }],
    );
    await svc.update('u1', 'a1', { status: AccountStatus.ACTIVE } as never, premium);
    expect(prisma.brokerConnection.updateMany).not.toHaveBeenCalled();
  });

  it('PASSED → Actif : jamais en pause, rien à rattraper', async () => {
    const { svc, prisma } = service(
      { status: AccountStatus.PASSED, statusChangedAt: ago(10 * 24 * H) },
      [{ id: 'c1', historyImportedAt: imported }],
    );
    await svc.update('u1', 'a1', { status: AccountStatus.ACTIVE } as never, premium);
    expect(prisma.brokerConnection.updateMany).not.toHaveBeenCalled();
  });

  it('archivage par suppression d’un compte avec historique : statusChangedAt posé', async () => {
    const { svc, prisma } = service({ status: AccountStatus.FAILED, statusChangedAt: ago(H) });
    await svc.remove('u1', 'a1');
    expect(dataOf(prisma)).toMatchObject({ status: AccountStatus.ARCHIVED, statusChangedAt: expect.any(Date) });
  });

  it('déjà archivé : la date d’origine est gardée', async () => {
    const { svc, prisma } = service({ status: AccountStatus.ARCHIVED, statusChangedAt: ago(10 * 24 * H) });
    await svc.remove('u1', 'a1');
    expect(dataOf(prisma)).not.toHaveProperty('statusChangedAt');
  });
});

describe('connexion sœur', () => {
  it('la propagation des jetons remet CONNECTED sans lever la pause, qui dépend du compte', () => {
    const conn = { accountId: 'a2', status: BrokerConnectionStatus.CONNECTED, provider: BrokerProvider.TRADOVATE, historyImportedAt: imported, availableAccounts: [] } as unknown as BrokerConnection;
    expect(toConnectionView(conn, 0, { status: AccountStatus.FAILED, statusChangedAt: ago(72 * H) }, now).syncPaused).toBe(true);
  });
});
