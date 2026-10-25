import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { TraderPushPreferencesDto } from './trader-push-preferences.dto';

// Mêmes options que le ValidationPipe global (main.ts) : un refus ici est un 400.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const check = (body: unknown) => pipe.transform(body, { type: 'body', metatype: TraderPushPreferencesDto });

describe('PATCH /push/preferences : heures silencieuses', () => {
  it('plage valide, ou null pour les désactiver : acceptée', async () => {
    await expect(check({ quietHours: { start: 22 * 60, end: 7 * 60 } })).resolves.toBeDefined();
    await expect(check({ quietHours: null })).resolves.toBeDefined();
  });

  it('début égal à la fin : 400 « Choisis deux heures différentes » (revue phase 2 I5)', async () => {
    const err = await check({ quietHours: { start: 7 * 60, end: 7 * 60 } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getStatus()).toBe(400);
    expect(JSON.stringify((err as BadRequestException).getResponse())).toContain('Choisis deux heures différentes');
  });

  it('hors bornes : 400', async () => {
    await expect(check({ quietHours: { start: 0, end: 1440 } })).rejects.toBeInstanceOf(BadRequestException);
  });
});
