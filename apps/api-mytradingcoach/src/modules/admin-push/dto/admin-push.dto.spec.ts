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

describe('SubscribePushDto · liste blanche des services push (revue #717, I1)', () => {
  it.each(['https://127.0.0.1/x', 'https://169.254.169.254/latest', 'https://10.0.0.5/x', 'https://[::1]/x', 'https://postgres.internal/x', 'https://evil.example.com/x'])(
    'adresse hors service push refusée : %s',
    async (endpoint) => {
      expect(await errorsOf(SubscribePushDto, { ...valid, endpoint })).toEqual(['endpoint']);
    },
  );

  it('FCM, Mozilla, Apple, Windows acceptés', async () => {
    for (const endpoint of ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/x', 'https://wns2-par02p.notify.windows.com/w/?token=x']) {
      expect(await errorsOf(SubscribePushDto, { ...valid, endpoint })).toEqual([]);
    }
  });
});

describe('PushPreferencesDto', () => {
  it('événements connus seulement', async () => {
    expect(await errorsOf(PushPreferencesDto, { endpoint: valid.endpoint, mutedEvents: ['SIGNUP', 'PREMIUM'] })).toEqual([]);
    expect(await errorsOf(PushPreferencesDto, { endpoint: valid.endpoint, mutedEvents: ['INCONNU'] })).toEqual(['mutedEvents']);
  });
});
