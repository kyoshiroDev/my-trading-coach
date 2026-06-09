import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../shared/redis.service';

const baseUser = {
  role: 'USER',
  name: 'Kevin',
  email: 'kevin@test.com',
  plan: 'FREE',
  createdAt: new Date(Date.now() - 4 * 86_400_000), // 4 jours
  referredBy: 'VAL',
  _count: { trades: 0 },
};

const mockPrisma = {
  user: { findUnique: vi.fn(), delete: vi.fn().mockResolvedValue({}) },
  deletedAccount: { create: vi.fn().mockReturnValue({ __op: 'create' }) },
  $transaction: vi.fn().mockResolvedValue([{}, {}]),
};

const mockRedis = { client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } };

describe('UsersService — suppression + trace DeletedAccount', () => {
  let service: UsersService;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser });
    mockPrisma.deletedAccount.create.mockReturnValue({ __op: 'create' });
    mockPrisma.user.delete.mockReturnValue({ __op: 'delete' });
    mockPrisma.$transaction.mockResolvedValue([{}, {}]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('deleteMe archive une trace puis supprime, dans une transaction', async () => {
    await service.deleteMe('user-1', 'Trop compliqué');

    expect(mockPrisma.deletedAccount.create).toHaveBeenCalledTimes(1);
    const data = mockPrisma.deletedAccount.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      name: 'Kevin', email: 'kevin@test.com', plan: 'FREE',
      hadTraded: false, tradesCount: 0, referredBy: 'VAL',
      deletedBy: 'self', reason: 'Trop compliqué',
    });
    expect(data.lifetimeDays).toBeGreaterThanOrEqual(3);
    expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    // create ET delete passés ensemble à $transaction
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it('reason vide → null', async () => {
    await service.deleteMe('user-1', '   ');
    expect(mockPrisma.deletedAccount.create.mock.calls[0][0].data.reason).toBeNull();
  });

  it('hadTraded true quand l’utilisateur a des trades', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, _count: { trades: 7 } });
    await service.deleteMe('user-1');
    const data = mockPrisma.deletedAccount.create.mock.calls[0][0].data;
    expect(data.hadTraded).toBe(true);
    expect(data.tradesCount).toBe(7);
    expect(data.deletedBy).toBe('self');
  });

  it('adminDelete trace avec deletedBy=admin', async () => {
    await service.adminDelete('user-1');
    expect(mockPrisma.deletedAccount.create.mock.calls[0][0].data.deletedBy).toBe('admin');
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('adminDelete refuse de supprimer un ADMIN (aucune trace, aucune suppression)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, role: 'ADMIN' });
    await expect(service.adminDelete('admin-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.deletedAccount.create).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});