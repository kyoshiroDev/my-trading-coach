import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UsersService } from './users.service';
import { AdminUpdateUserDto } from './dto/admin-user.dto';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AmbassadorService } from '../ambassador/ambassador.service';

/** Interrupteur « Compte interne » de la fiche admin (#823) : PATCH /admin/users/:id. */
const prisma = { user: { findUnique: vi.fn(), update: vi.fn() } };
const service = new UsersService(prisma as unknown as PrismaService, {} as AmbassadorService, {} as never);

beforeEach(() => {
  vi.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue({ role: 'USER' });
  prisma.user.update.mockResolvedValue({ id: 'u1', isInternal: true });
});

describe('UsersService.adminUpdate — compte interne', () => {
  it('écrit isInternal et le renvoie dans la réponse', async () => {
    await service.adminUpdate('u1', { isInternal: true });
    const arg = prisma.user.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'u1' });
    expect(arg.data).toEqual({ isInternal: true });
    expect(arg.select.isInternal).toBe(true);
  });

  it('un compte ADMIN reste intouchable', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
    await expect(service.adminUpdate('u1', { isInternal: true })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('AdminUpdateUserDto — isInternal', () => {
  const errors = async (body: object) => validate(plainToInstance(AdminUpdateUserDto, body));

  it('booléen accepté, absent accepté', async () => {
    expect(await errors({ isInternal: true })).toHaveLength(0);
    expect(await errors({ isInternal: false })).toHaveLength(0);
    expect(await errors({})).toHaveLength(0);
  });

  it('autre chose qu’un booléen refusé', async () => {
    expect((await errors({ isInternal: 'true' }))[0]?.property).toBe('isInternal');
    expect((await errors({ isInternal: 1 }))[0]?.property).toBe('isInternal');
  });
});
