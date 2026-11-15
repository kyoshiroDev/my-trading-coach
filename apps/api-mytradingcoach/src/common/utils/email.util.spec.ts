import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { emailEquals, emailTransform, escapeLike, normalizeEmail } from './email.util';
import { LoginDto } from '../../modules/auth/dto/login.dto';
import { RegisterDto } from '../../modules/auth/dto/register.dto';
import { ForgotPasswordDto } from '../../modules/auth/dto/forgot-password.dto';
import { PromoteAmbassadorDto, RevokeAmbassadorDto } from '../../modules/ambassador/dto/admin-ambassador.dto';

describe('e-mails insensibles à la casse (#999)', () => {
  it('normalizeEmail : espaces autour retirés, minuscules', () => {
    expect(normalizeEmail('  Alice.Martin@Gmail.COM ')).toBe('alice.martin@gmail.com');
  });

  it('emailTransform laisse passer tout ce qui n’est pas une chaîne (la validation tranche)', () => {
    expect(emailTransform({ value: 42 })).toBe(42);
    expect(emailTransform({ value: undefined })).toBeUndefined();
  });

  it('escapeLike échappe `\\`, `_` et `%`, rien d’autre', () => {
    expect(escapeLike('a_b%c\\d.e+f@x.com')).toBe('a\\_b\\%c\\\\d.e+f@x.com');
  });

  it('emailEquals : égalité sans casse ni joker', () => {
    expect(emailEquals(' A_B@X.com')).toEqual({ equals: 'a\\_b@x.com', mode: 'insensitive' });
  });

  it.each([
    ['LoginDto', LoginDto, { password: 'password123' }],
    ['RegisterDto', RegisterDto, { password: 'password123' }],
    ['ForgotPasswordDto', ForgotPasswordDto, {}],
    ['PromoteAmbassadorDto', PromoteAmbassadorDto, {}],
    ['RevokeAmbassadorDto', RevokeAmbassadorDto, {}],
  ])('%s : adresse normalisée avant la validation', async (_n, Dto, rest) => {
    const dto = plainToInstance(Dto as new () => { email: string }, { ...rest, email: '  Alice@Test.COM ' });
    expect(dto.email).toBe('alice@test.com');
    expect(await validate(dto)).toEqual([]);
  });
});
