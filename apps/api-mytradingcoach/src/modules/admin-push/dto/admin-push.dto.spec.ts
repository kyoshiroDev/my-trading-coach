import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PushPreferencesDto, SubscribePushDto } from './admin-push.dto';

const valid = {
  endpoint: 'https://web.push.apple.com/QGxyz',
  expirationTime: null,
  keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
};
// Mêmes options que le ValidationPipe global (main.ts).
const errorsOf = async (cls: new () => object, body: unknown) =>
  (await validate(plainToInstance(cls, body) as object, { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property);

describe('SubscribePushDto', () => {
  it('PushSubscription.toJSON() d’un navigateur (expirationTime null compris) → accepté', async () => {
    expect(await errorsOf(SubscribePushDto, valid)).toEqual([]);
  });

  it('endpoint non https, clés mal formées ou champ inconnu → refusé', async () => {
    expect(await errorsOf(SubscribePushDto, { ...valid, endpoint: 'http://web.push.apple.com/x' })).toEqual(['endpoint']);
    expect(await errorsOf(SubscribePushDto, { ...valid, keys: { p256dh: 'court', auth: 'a'.repeat(22) } })).toEqual(['keys']);
    expect(await errorsOf(SubscribePushDto, { ...valid, extra: 1 })).toEqual(['extra']);
  });
});

describe('PushPreferencesDto', () => {
  it('événements connus seulement', async () => {
    expect(await errorsOf(PushPreferencesDto, { endpoint: valid.endpoint, mutedEvents: ['SIGNUP', 'PREMIUM'] })).toEqual([]);
    expect(await errorsOf(PushPreferencesDto, { endpoint: valid.endpoint, mutedEvents: ['INCONNU'] })).toEqual(['mutedEvents']);
  });
});
