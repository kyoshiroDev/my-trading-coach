import { describe, it, expect } from 'vitest';
import webpush from 'web-push';
import { resolvePushConfig } from './push-config';
import { checkEnv, ENV_VARS } from './env';

const keys = webpush.generateVAPIDKeys();
const valid = {
  PUSH_ENABLED: 'true',
  VAPID_PUBLIC_KEY: keys.publicKey,
  VAPID_PRIVATE_KEY: keys.privateKey,
  VAPID_SUBJECT: 'mailto:hello@mytradingcoach.app',
};

describe('resolvePushConfig', () => {
  it('config complète → push activé avec les clés', () => {
    const r = resolvePushConfig(valid);
    expect(r).toEqual({ enabled: true, config: { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: valid.VAPID_SUBJECT } });
  });

  it('PUSH_ENABLED absent ou false → désactivé, même avec des clés', () => {
    expect(resolvePushConfig({ ...valid, PUSH_ENABLED: undefined }).enabled).toBe(false);
    expect(resolvePushConfig({ ...valid, PUSH_ENABLED: 'false' }).enabled).toBe(false);
  });

  it('clé manquante ou mal formée → désactivé, la raison nomme la variable', () => {
    const r = resolvePushConfig({ ...valid, VAPID_PRIVATE_KEY: 'trop-courte', VAPID_SUBJECT: 'hello@x' });
    expect(r).toEqual({ enabled: false, reason: 'invalide ou absente : VAPID_PRIVATE_KEY, VAPID_SUBJECT' });
  });

  it('clés inversées (publique ↔ privée) → désactivé', () => {
    const r = resolvePushConfig({ ...valid, VAPID_PUBLIC_KEY: keys.privateKey, VAPID_PRIVATE_KEY: keys.publicKey });
    expect(r.enabled).toBe(false);
  });
});

describe('checkEnv : variables du push', () => {
  const allRequired = Object.fromEntries(ENV_VARS.filter((v) => v.level === 'required').map((v) => [v.name, 'x']));

  it('clés VAPID valides → rien à signaler ; mal formées → avertissement, jamais bloquant', () => {
    expect(checkEnv({ ...allRequired, ...valid }, true).warnings.filter((w) => /VAPID|PUSH/.test(w))).toEqual([]);
    const bad = checkEnv({ ...allRequired, PUSH_ENABLED: 'oui', VAPID_PUBLIC_KEY: 'x' }, true);
    expect(bad.errors).toEqual([]);
    expect(bad.warnings.filter((w) => /VAPID|PUSH/.test(w))).toHaveLength(2);
  });
});
