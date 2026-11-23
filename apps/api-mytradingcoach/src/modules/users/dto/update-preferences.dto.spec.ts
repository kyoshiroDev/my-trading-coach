import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdatePreferencesDto } from './update-preferences.dto';

const errorsOf = (body: object) => validateSync(plainToInstance(UpdatePreferencesDto, body)).map((e) => e.property);

describe('UpdatePreferencesDto — bouclier annonces (#670)', () => {
  it('0 (coupé) à 30 minutes acceptés, absent = inchangé', () => {
    expect(errorsOf({ newsShieldMinutes: 0 })).toEqual([]);
    expect(errorsOf({ newsShieldMinutes: 5 })).toEqual([]);
    expect(errorsOf({ newsShieldMinutes: 30 })).toEqual([]);
    expect(errorsOf({})).toEqual([]);
  });

  it('négatif, au-delà de 30 ou non entier : refusé', () => {
    expect(errorsOf({ newsShieldMinutes: -1 })).toEqual(['newsShieldMinutes']);
    expect(errorsOf({ newsShieldMinutes: 31 })).toEqual(['newsShieldMinutes']);
    expect(errorsOf({ newsShieldMinutes: 2.5 })).toEqual(['newsShieldMinutes']);
  });
});
