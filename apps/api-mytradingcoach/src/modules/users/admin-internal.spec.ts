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

/**
 * A1 = S5 = B1 et B2 (#1064) : la modale « Modifier » écrivait le rôle et le plan en direct
 * (`data: dto`). Un AMBASSADOR sans code, un abonné Stripe passé FREE alors que Stripe prélève…
 * Décision du 16/11 : la modale ne garde que le nom et « compte interne ». Le rôle passe par
 * setRole (promouvoir / retirer, bêta), le plan par « Offrir Premium » ou le rôle bêta.
 */
describe('AdminUpdateUserDto — ni rôle ni plan (A1/B2 #1064)', () => {
  // Mêmes options que le ValidationPipe global (main.ts).
  const errors = async (body: object) =>
    validate(plainToInstance(AdminUpdateUserDto, body), { whitelist: true, forbidNonWhitelisted: true });

  it('rôle refusé', async () => {
    expect((await errors({ role: 'AMBASSADOR' })).map((e) => e.property)).toEqual(['role']);
  });

  it('plan refusé', async () => {
    expect((await errors({ plan: 'FREE' })).map((e) => e.property)).toEqual(['plan']);
  });

  it('nom et compte interne acceptés', async () => {
    expect(await errors({ name: 'Jean', isInternal: true })).toHaveLength(0);
  });
});
