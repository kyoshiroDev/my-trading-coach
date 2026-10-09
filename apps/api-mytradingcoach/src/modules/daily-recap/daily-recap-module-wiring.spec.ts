/** Câblage d'APP_ROLE pour la file des récaps (SCA-B5-01, même principe que app-role-wiring.spec.ts). */
import 'reflect-metadata';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MODULE_METADATA } from '@nestjs/common/constants';

const { stub } = vi.hoisted(() => ({
  stub: (...names: string[]) =>
    Object.fromEntries(names.map((n) => [n, Object.defineProperty(class {}, 'name', { value: n })])),
}));

vi.mock('../../prisma/prisma.module', () => stub('PrismaModule'));
vi.mock('../ai/ai.module', () => stub('AiModule'));
vi.mock('../resend/resend.module', () => stub('ResendModule'));
vi.mock('../accounts/accounts.module', () => stub('AccountsModule'));
vi.mock('./daily-recap.service', () => stub('DailyRecapService'));
vi.mock('./daily-recap.cron', () => stub('DailyRecapCron'));
vi.mock('./daily-recap.processor', () => stub('DailyRecapProcessor'));

async function providers(role: string): Promise<string[]> {
  vi.resetModules();
  vi.stubEnv('APP_ROLE', role);
  const { DailyRecapModule } = await import('./daily-recap.module');
  return ((Reflect.getMetadata(MODULE_METADATA.PROVIDERS, DailyRecapModule) ?? []) as Array<{ name: string }>).map((p) => p.name);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('DailyRecapModule selon APP_ROLE', () => {
  it('DailyRecapProcessor présent en all / worker, absent en web ; le cron partout', async () => {
    expect(await providers('')).toContain('DailyRecapProcessor');
    expect(await providers('worker')).toContain('DailyRecapProcessor');
    const web = await providers('web');
    expect(web).not.toContain('DailyRecapProcessor');
    expect(web).toContain('DailyRecapCron');
  });
});
