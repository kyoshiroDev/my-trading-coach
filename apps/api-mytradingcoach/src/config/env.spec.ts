import { describe, it, expect } from 'vitest';
import { checkEnv, ENV_VARS } from './env';

const allRequired = Object.fromEntries(
  ENV_VARS.filter((v) => v.level === 'required').map((v) => [v.name, 'x']),
);

describe('checkEnv', () => {
  it('variable requise manquante → erreur bloquante', () => {
    const { errors } = checkEnv({ ...allRequired, JWT_SECRET: '' }, false);
    expect(errors).toEqual(['JWT_SECRET manquante']);
  });

  it('variable de production manquante → avertissement en prod seulement', () => {
    expect(checkEnv(allRequired, false).warnings).toEqual([]);
    expect(checkEnv(allRequired, true).warnings).toContain('REDIS_HOST manquante (indispensable en production)');
  });

  it('format invalide → avertissement', () => {
    const { errors, warnings } = checkEnv({ ...allRequired, BROKER_TOKEN_ENCRYPTION_KEY: 'trop-court', AI_ENABLED: 'oui' }, false);
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(2);
  });

  it('environnement complet et valide → rien à signaler', () => {
    const key = Buffer.alloc(32, 1).toString('base64');
    const env = { ...allRequired, REDIS_HOST: 'redis', CORS_ORIGINS: 'https://app', FRONTEND_URL: 'https://app', SENTRY_DSN: 'https://k@o.ingest.sentry.io/1', BROKER_TOKEN_ENCRYPTION_KEY: key, AI_ENABLED: 'true', PORT: '3000', STRIPE_PUBLIC_KEY: 'pk_live_x' };
    expect(checkEnv(env, true)).toEqual({ errors: [], warnings: [] });
  });

  it('clé publiable Stripe : absente en prod → avertissement ; format vérifié', () => {
    expect(checkEnv(allRequired, true).warnings).toContain('STRIPE_PUBLIC_KEY manquante (indispensable en production)');
    expect(checkEnv({ ...allRequired, STRIPE_PUBLIC_KEY: 'sk_live_x' }, false).warnings).toHaveLength(1);
  });

  it('production sans SENTRY_DSN → avertissement (aucune erreur suivie sinon)', () => {
    const env = { ...allRequired, REDIS_HOST: 'redis', CORS_ORIGINS: 'https://app', FRONTEND_URL: 'https://app' };
    expect(checkEnv(env, true).warnings).toContain('SENTRY_DSN manquante (indispensable en production)');
  });
});
