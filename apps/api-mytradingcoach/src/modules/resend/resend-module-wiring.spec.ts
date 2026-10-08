/**
 * Câblage d'APP_ROLE pour la file e-mail (SCA-B5-02, même principe que app-role-wiring.spec.ts) :
 * le processeur n'existe que là où les files sont consommées, le web ne fait que les alimenter.
 */
import 'reflect-metadata';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MODULE_METADATA } from '@nestjs/common/constants';

const { stub } = vi.hoisted(() => ({
  stub: (...names: string[]) =>
    Object.fromEntries(names.map((n) => [n, Object.defineProperty(class {}, 'name', { value: n })])),
}));

vi.mock('./resend.service', () => stub('ResendService'));
vi.mock('./resend.cron', () => stub('ResendCron'));
vi.mock('./email-dispatch.service', () => stub('EmailDispatchService'));
vi.mock('./crons/auto-campaigns.cron', () => stub('AutoCampaignsCron'));
vi.mock('./emails.controller', () => stub('EmailsController'));
vi.mock('./emails.service', () => stub('EmailsService'));
vi.mock('./email.processor', () => stub('EmailProcessor'));

async function providers(role: string): Promise<string[]> {
  vi.resetModules();
  vi.stubEnv('APP_ROLE', role);
  const { ResendModule } = await import('./resend.module');
  return ((Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ResendModule) ?? []) as Array<{ name: string }>).map((p) => p.name);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ResendModule selon APP_ROLE', () => {
  it('EmailProcessor présent en all / worker, absent en web ; ResendService partout', async () => {
    expect(await providers('')).toContain('EmailProcessor');
    expect(await providers('worker')).toContain('EmailProcessor');
    const web = await providers('web');
    expect(web).not.toContain('EmailProcessor');
    expect(web).toContain('ResendService');
  });
});
