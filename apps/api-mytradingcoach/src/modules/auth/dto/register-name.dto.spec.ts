import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';
import { AdminUpdateUserDto } from '../../users/dto/admin-user.dto';

// S1 (#1063) : le nom n'avait aucune borne à l'inscription ni dans la modale admin.
const nameErrors = async (cls: new () => object, body: object) =>
  (await validate(plainToInstance(cls, body) as object)).filter((e) => e.property === 'name');

describe('nom borné à 100 caractères (S1 #1063)', () => {
  it('inscription', async () => {
    const base = { email: 'a@test.com', password: 'Motdepasse1!' };
    expect(await nameErrors(RegisterDto, { ...base, name: 'x'.repeat(100) })).toHaveLength(0);
    expect(await nameErrors(RegisterDto, { ...base, name: 'x'.repeat(101) })).toHaveLength(1);
  });

  it('modale admin', async () => {
    expect(await nameErrors(AdminUpdateUserDto, { name: 'x'.repeat(100) })).toHaveLength(0);
    expect(await nameErrors(AdminUpdateUserDto, { name: 'x'.repeat(101) })).toHaveLength(1);
  });
});
