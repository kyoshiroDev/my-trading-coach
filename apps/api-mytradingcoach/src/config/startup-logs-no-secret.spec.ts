import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { ResendService } from '../modules/resend/resend.service';
import type { RedisService } from '../modules/infra/redis.service';
import { checkEnv, ENV_VARS } from './env';

vi.mock('resend', () => ({ Resend: vi.fn().mockImplementation(function () { return { emails: { send: vi.fn() } }; }) }));

/**
 * Journaux de démarrage : aucune valeur de variable secrète, ni entière ni en morceau. Les valeurs
 * ci-dessous sont factices et volontairement mal formées, pour déclencher aussi les avertissements
 * de `checkEnv`.
 */
const SECRETS: Record<string, string> = {
  RESEND_API_KEY: 're_FAKEkey1234567890abcdef',
  DATABASE_URL: 'postgresql://user:FAKEdbpass987@db:5432/mtc',
  REDIS_PASSWORD: 'FAKEredispass654',
  JWT_SECRET: 'FAKEjwtsecret321',
  JWT_REFRESH_SECRET: 'FAKEjwtrefresh321',
  ANTHROPIC_API_KEY: 'sk-ant-FAKEanthropic000',
  STRIPE_SECRET_KEY: 'sk_live_FAKEstripe111',
  STRIPE_WEBHOOK_SECRET: 'whsec_FAKEwebhook222',
  STRIPE_PUBLIC_KEY: 'xx_FAKEpublic333',
  SENTRY_DSN: 'https://FAKEdsn444@o1.ingest.sentry.io/1',
  BROKER_TOKEN_ENCRYPTION_KEY: 'FAKEbrokerkey555',
  VAPID_PRIVATE_KEY: 'FAKEvapid666',
  LOAD_TEST_KEY: 'FAKEshort777',
};

/** Tous les morceaux de 6 caractères d'une valeur : un préfixe de clé compte aussi comme une fuite. */
function fragments(value: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 6 <= value.length; i++) out.push(value.slice(i, i + 6));
  return out;
}

function captureLogs(): { lines: string[] } {
  const captured = { lines: [] as string[] };
  for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
      captured.lines.push(args.map(String).join(' '));
    });
  }
  return captured;
}

function expectNoSecret(lines: string[]) {
  const text = lines.join('\n');
  for (const [name, value] of Object.entries(SECRETS)) {
    // Les fragments communs (« postgr », « https: ») ne sont pas secrets : seuls ceux qui
    // contiennent le marqueur FAKE ou un morceau propre à la valeur comptent.
    for (const frag of fragments(value).filter((f) => /[A-Z0-9]{2}/.test(f) && !/^(https|postgr)/.test(f))) {
      expect(text, `${name} : « ${frag} » dans les journaux`).not.toContain(frag);
    }
  }
}

describe('journaux de démarrage sans secret', () => {
  afterEach(() => vi.restoreAllMocks());

  it('ResendService : signale la configuration sans aucun caractère de la clé', () => {
    const logs = captureLogs();
    const config = {
      getOrThrow: (k: string) => SECRETS[k],
      get: (k: string) => ({ FRONTEND_URL: 'http://localhost:4200' } as Record<string, string>)[k],
    } as unknown as ConfigService;
    new ResendService(config, {} as RedisService, {} as Queue);
    expectNoSecret(logs.lines);
    expect(logs.lines.some((l) => l.includes('Resend configuré'))).toBe(true);
  });

  it('checkEnv : les avertissements et erreurs nomment la variable, jamais sa valeur', () => {
    const report = checkEnv({ ...SECRETS, NODE_ENV: 'production' }, true);
    // Les valeurs mal formées produisent bien des avertissements (sinon le test ne prouverait rien).
    expect(report.warnings.some((w) => w.startsWith('STRIPE_PUBLIC_KEY'))).toBe(true);
    expect(report.warnings.some((w) => w.startsWith('LOAD_TEST_KEY'))).toBe(true);
    expectNoSecret([...report.warnings, ...report.errors]);
    expect(ENV_VARS.length).toBeGreaterThan(0);
  });
});
