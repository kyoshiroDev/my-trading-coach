import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { DEMO_ALLOWED_KEY } from '../../common/decorators/demo-allowed.decorator';
import { TraderPushController } from './trader-push.controller';

/** Compte démo (revue #717, m6) : seule la lecture de l'état de l'appareil passe parmi les POST. */
describe('TraderPushController · démo', () => {
  const allowed = (method: keyof TraderPushController) =>
    Reflect.getMetadata(DEMO_ALLOWED_KEY, TraderPushController.prototype[method]) === true;

  it('POST /push/device (lecture) autorisé en démo', () => {
    expect(allowed('device')).toBe(true);
  });

  it('abonnement, désabonnement, suppression, préférences et test restent bloqués', () => {
    for (const m of ['subscribe', 'unsubscribe', 'removeDevice', 'preferences', 'test'] as const) expect(allowed(m)).toBe(false);
  });
});
