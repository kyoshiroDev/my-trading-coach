import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';

const base = { email: 'test@test.com', password: 'password123' };

describe('RegisterDto — UTM d’acquisition', () => {
  it('normalise les UTM (trim + minuscules)', async () => {
    const dto = plainToInstance(RegisterDto, {
      ...base,
      acquisitionSource: '  NinjaTrader ',
      acquisitionMedium: 'Listing',
      acquisitionCampaign: 'Ecosystem',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.acquisitionSource).toBe('ninjatrader');
    expect(dto.acquisitionMedium).toBe('listing');
    expect(dto.acquisitionCampaign).toBe('ecosystem');
  });

  it('traite une chaîne vide comme absente', async () => {
    const dto = plainToInstance(RegisterDto, { ...base, acquisitionSource: '   ' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.acquisitionSource).toBeUndefined();
  });

  it('refuse un UTM de plus de 100 caractères ou non textuel', async () => {
    const long = plainToInstance(RegisterDto, { ...base, acquisitionSource: 'x'.repeat(101) });
    expect(await validate(long)).not.toHaveLength(0);
    const num = plainToInstance(RegisterDto, { ...base, acquisitionMedium: 42 });
    expect(await validate(num)).not.toHaveLength(0);
  });
});
