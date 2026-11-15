import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AcquisitionPeriodQueryDto, AcquisitionQueryDto } from './acquisition-query.dto';

describe('AcquisitionPeriodQueryDto', () => {
  it('accepte 7 et 30 (query string), et rien', async () => {
    for (const q of [{ days: '7' }, { days: '30' }, {}]) {
      expect(await validate(plainToInstance(AcquisitionPeriodQueryDto, q))).toHaveLength(0);
    }
    expect(plainToInstance(AcquisitionPeriodQueryDto, { days: '7' }).days).toBe(7);
  });

  it('refuse toute autre période', async () => {
    for (const days of ['1', '90', 'abc']) {
      expect(await validate(plainToInstance(AcquisitionPeriodQueryDto, { days }))).not.toHaveLength(0);
    }
  });
});

describe('AcquisitionQueryDto (« Inclure les tests », #1029)', () => {
  it('includeTests vrai seulement pour true ou 1, faux sinon', async () => {
    expect(plainToInstance(AcquisitionQueryDto, { includeTests: 'true' }).includeTests).toBe(true);
    expect(plainToInstance(AcquisitionQueryDto, { includeTests: '1' }).includeTests).toBe(true);
    expect(plainToInstance(AcquisitionQueryDto, { includeTests: 'false' }).includeTests).toBe(false);
    expect(plainToInstance(AcquisitionQueryDto, { includeTests: 'oui' }).includeTests).toBe(false);
    expect(plainToInstance(AcquisitionQueryDto, {}).includeTests).toBeUndefined();
    expect(await validate(plainToInstance(AcquisitionQueryDto, { includeTests: 'true' }))).toHaveLength(0);
  });
});
