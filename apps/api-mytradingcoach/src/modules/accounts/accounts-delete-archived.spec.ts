import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { AccountsService } from './accounts.service';

/**
 * « Supprimer » un compte ARCHIVÉ (DELETE /accounts/:id/archived) : le compte et tous ses trades.
 * Toutes les règles sont serveur : confirmation, propriétaire, statut archivé (rejoué dans la
 * transaction), connexion broker effacée, cache des statistiques invalidé.
 */
const archived = { id: 'acc-arc', userId: 'u1', label: 'Test NT8', status: AccountStatus.ARCHIVED };

function setup(account: object | null = archived, opts: { deletedCount?: number; trades?: number } = {}) {
  const calls: string[] = [];
  const tx = {
    trade: { deleteMany: vi.fn(async () => { calls.push('trades'); return { count: opts.trades ?? 12 }; }) },
    tradeSession: { deleteMany: vi.fn(async () => { calls.push('sessions'); return { count: 3 }; }) },
    brokerConnection: { deleteMany: vi.fn(async () => { calls.push('connexion'); return { count: 1 }; }) },
    behaviorBaseline: { deleteMany: vi.fn(async () => { calls.push('baseline'); return { count: 1 }; }) },
    tradingAccount: { deleteMany: vi.fn(async () => { calls.push('compte'); return { count: opts.deletedCount ?? 1 }; }) },
  };
  const prisma = {
    tradingAccount: { findUnique: vi.fn(async () => account) },
    trade: { count: vi.fn(async () => 12) },
    tradeSession: { count: vi.fn(async () => 3) },
    brokerConnection: { count: vi.fn(async () => 1) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const multi = { incr: vi.fn(), expire: vi.fn(), exec: vi.fn(async () => []) };
  multi.incr.mockReturnValue(multi);
  multi.expire.mockReturnValue(multi);
  const svc = new AccountsService(prisma as never, { client: { multi: () => multi } } as never);
  return { svc, prisma, tx, calls, multi };
}

describe('AccountsService.deleteArchived', () => {
  it.each([undefined, false, 'true', 1, {}])('confirm=%j → 400, aucune lecture ni écriture', async (confirm) => {
    const { svc, prisma } = setup();
    await expect(svc.deleteArchived('u1', 'acc-arc', confirm)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.tradingAccount.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('compte d\'un autre utilisateur → 404, aucune transaction', async () => {
    const { svc, prisma } = setup({ ...archived, userId: 'u2' });
    await expect(svc.deleteArchived('u1', 'acc-arc', true)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('compte inexistant → 404', async () => {
    const { svc } = setup(null);
    await expect(svc.deleteArchived('u1', 'nope', true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([AccountStatus.ACTIVE, AccountStatus.PASSED, AccountStatus.FAILED])(
    'compte %s (non archivé) → 409 ACCOUNT_NOT_ARCHIVED, aucune transaction',
    async (status) => {
      const { svc, prisma } = setup({ ...archived, status });
      const err = await svc.deleteArchived('u1', 'acc-arc', true).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({ code: 'ACCOUNT_NOT_ARCHIVED' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('compte archivé avec trades et connexion broker : tout effacé dans la transaction, compte en dernier ; cache vidé', async () => {
    const { svc, tx, calls, multi } = setup();
    const res = await svc.deleteArchived('u1', 'acc-arc', true);

    expect(res).toEqual({ deleted: true, tradesDeleted: 12 });
    expect(calls).toEqual(['trades', 'sessions', 'connexion', 'baseline', 'compte']);
    expect(tx.trade.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', accountId: 'acc-arc' } });
    expect(tx.tradeSession.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', accountId: 'acc-arc' } });
    expect(tx.brokerConnection.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', accountId: 'acc-arc' } });
    // Garde rejouée au moment de supprimer : propriétaire ET toujours archivé.
    expect(tx.tradingAccount.deleteMany).toHaveBeenCalledWith({ where: { id: 'acc-arc', userId: 'u1', status: AccountStatus.ARCHIVED } });
    expect(multi.incr).toHaveBeenCalledWith('analytics:v:u1');
  });

  it('sans trade : la référence de comportement n\'est pas touchée', async () => {
    const { svc, tx } = setup(archived, { trades: 0 });
    await expect(svc.deleteArchived('u1', 'acc-arc', true)).resolves.toEqual({ deleted: true, tradesDeleted: 0 });
    expect(tx.behaviorBaseline.deleteMany).not.toHaveBeenCalled();
  });

  it('désarchivé entre la lecture et la suppression : 409 levé DANS la transaction (rollback), cache intact', async () => {
    const { svc, multi } = setup(archived, { deletedCount: 0 });
    await expect(svc.deleteArchived('u1', 'acc-arc', true)).rejects.toBeInstanceOf(ConflictException);
    expect(multi.incr).not.toHaveBeenCalled();
  });
});

describe('AccountsService.deletionPreview', () => {
  it('compte : nombre total de trades, séances, connexion broker', async () => {
    const { svc, prisma } = setup();
    await expect(svc.deletionPreview('u1', 'acc-arc')).resolves.toEqual({
      archived: true, tradesCount: 12, sessionsCount: 3, brokerConnected: true,
    });
    expect(prisma.trade.count).toHaveBeenCalledWith({ where: { userId: 'u1', accountId: 'acc-arc' } });
  });

  it('compte d\'un autre utilisateur → 404', async () => {
    const { svc } = setup({ ...archived, userId: 'u2' });
    await expect(svc.deletionPreview('u1', 'acc-arc')).rejects.toBeInstanceOf(NotFoundException);
  });
});
