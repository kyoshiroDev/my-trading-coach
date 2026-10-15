import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SignupFunnelQueryDto } from './signup-funnel-query.dto';

describe('SignupFunnelQueryDto', () => {
  it('accepte 7 et 30 (query string), et rien', async () => {
    for (const q of [{ days: '7' }, { days: '30' }, {}]) {
      expect(await validate(plainToInstance(SignupFunnelQueryDto, q))).toHaveLength(0);
    }
    expect(plainToInstance(SignupFunnelQueryDto, { days: '7' }).days).toBe(7);
  });

  it('refuse toute autre période', async () => {
    for (const days of ['1', '90', 'abc']) {
      expect(await validate(plainToInstance(SignupFunnelQueryDto, { days }))).not.toHaveLength(0);
    }
  });
});
