import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminListQueryDto } from './dto/admin-user.dto';

describe('AdminListQueryDto.limit plafonné à 100 (#1063)', () => {
  it('100 accepté, 101 refusé (limit=100000 chargeait toute la table)', async () => {
    const errs = async (limit: string) =>
      (await validate(plainToInstance(AdminListQueryDto, { limit }))).filter((e) => e.property === 'limit');
    expect(await errs('100')).toHaveLength(0);
    expect(await errs('101')).toHaveLength(1);
  });
});
