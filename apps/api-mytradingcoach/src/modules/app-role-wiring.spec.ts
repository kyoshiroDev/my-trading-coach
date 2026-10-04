/**
 * Câblage d'APP_ROLE (SCA-B6-01) : les listes de providers sont figées à l'import du module, on
 * réimporte donc chaque module avec l'environnement voulu.
 */
import 'reflect-metadata';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MODULE_METADATA } from '@nestjs/common/constants';

async function providersOf(path: string, exportName: string, env: Record<string, string | undefined>): Promise<string[]> {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string);
  const mod = (await import(path))[exportName];
  const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, mod) ?? []) as Array<{ name?: string; provide?: unknown }>;
  return providers.map((p) => p.name ?? String(p.provide));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('processeurs BullMQ selon APP_ROLE', () => {
  it.each([
    ['./debrief/debrief.module', 'DebriefModule', 'DebriefProcessor'],
    ['./stripe/stripe.module', 'StripeModule', 'StripeProcessor'],
  ])('%s : présent en all / worker, absent en web', async (path, name, processor) => {
    expect(await providersOf(path, name, { APP_ROLE: '' })).toContain(processor);
    expect(await providersOf(path, name, { APP_ROLE: 'worker' })).toContain(processor);
    expect(await providersOf(path, name, { APP_ROLE: 'web' })).not.toContain(processor);
  }, 30_000);
});
