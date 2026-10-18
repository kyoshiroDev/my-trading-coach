import { describe, it, expect, vi, beforeEach } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UTM_NONE } from '@mtc/shared';
import { UsersService } from './users.service';
import { AdminListQueryDto } from './dto/admin-user.dto';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AmbassadorService } from '../ambassador/ambassador.service';

/** Liste admin filtrée par UTM d'inscription (#625) : retrouver les inscrits d'une campagne. */
const prisma = { user: { findMany: vi.fn(), count: vi.fn() } };
const service = new UsersService(prisma as unknown as PrismaService, {} as AmbassadorService);
const where = () => prisma.user.findMany.mock.calls[0][0].where;

beforeEach(() => {
  vi.clearAllMocks();
  prisma.user.findMany.mockResolvedValue([]);
  prisma.user.count.mockResolvedValue(0);
});

describe('UsersService.adminFindAll — filtre par campagne', () => {
  it('sans filtre : tous les comptes hors démo', async () => {
    await service.adminFindAll(1, 20);
    expect(where()).toEqual({ isDemo: false });
  });

  it('triplet complet : égalité exacte sur les 3 champs, même filtre pour le total', async () => {
    await service.adminFindAll(1, 20, undefined, { source: 'instagram', medium: 'dm', campaign: 'louis' });
    const expected = {
      isDemo: false, acquisitionSource: 'instagram', acquisitionMedium: 'dm', acquisitionCampaign: 'louis',
    };
    expect(where()).toEqual(expected);
    expect(prisma.user.count).toHaveBeenCalledWith({ where: expected });
  });

  it('« - » = non renseigné (null), champ absent = ignoré', async () => {
    await service.adminFindAll(1, 20, undefined, { source: 'instagram', campaign: UTM_NONE });
    expect(where()).toEqual({ isDemo: false, acquisitionSource: 'instagram', acquisitionCampaign: null });
  });

  it('se combine avec la recherche e-mail / nom', async () => {
    await service.adminFindAll(1, 20, 'gmail', { campaign: 'louis' });
    expect(where()).toMatchObject({ acquisitionCampaign: 'louis', OR: expect.any(Array) });
  });
});

describe('AdminListQueryDto — UTM normalisés comme à l’inscription', () => {
  it('minuscules, espaces retirés, vide ignoré', async () => {
    const dto = plainToInstance(AdminListQueryDto, { source: ' Instagram ', medium: 'DM', campaign: '  ' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({ source: 'instagram', medium: 'dm' });
    expect(dto.campaign).toBeUndefined();
  });

  it('refuse une valeur trop longue', async () => {
    const dto = plainToInstance(AdminListQueryDto, { campaign: 'x'.repeat(101) });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
