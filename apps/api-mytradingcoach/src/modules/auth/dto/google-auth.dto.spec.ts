import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GoogleAuthDto } from './google-auth.dto';

const base = { credential: 'x'.repeat(40) };

describe('GoogleAuthDto (#618)', () => {
  it('normalise les UTM comme une inscription e-mail', async () => {
    const dto = plainToInstance(GoogleAuthDto, { ...base, acquisitionSource: ' Instagram ', acquisitionMedium: 'Story' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.acquisitionSource).toBe('instagram');
    expect(dto.acquisitionMedium).toBe('story');
  });

  it('refuse un jeton absent, trop court ou démesuré', async () => {
    for (const credential of [undefined, 'court', 'x'.repeat(4097)]) {
      expect(await validate(plainToInstance(GoogleAuthDto, { credential }))).not.toHaveLength(0);
    }
  });

  it('refuse un code parrain de plus de 20 caractères', async () => {
    const dto = plainToInstance(GoogleAuthDto, { ...base, referralCode: 'X'.repeat(21) });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('l’opt-in marketing ne fait pas partie du corps (refusé par forbidNonWhitelisted)', async () => {
    const dto = plainToInstance(GoogleAuthDto, { ...base, marketingConsent: true });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.map((e) => e.property)).toContain('marketingConsent');
  });
});
