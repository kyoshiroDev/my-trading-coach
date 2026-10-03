/**
 * En-tête de cache de `/public/stats` (SCA-B3-07), sur la vraie app : rien dans la chaîne (Helmet,
 * intercepteurs, filtre) ne doit l'écraser. Les autres routes publiques n'en reçoivent pas.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PUBLIC_STATS_CACHE_CONTROL } from './public.controller';

let app: INestApplication;
let baseUrl: string;

beforeAll(async () => {
  ({ app, baseUrl } = await createIntegrationApp());
}, 120_000);
afterAll(async () => {
  await app?.close().catch(() => undefined);
});

describe('GET /public/stats — cache HTTP', () => {
  it('Cache-Control: public, max-age=300, stale-while-revalidate=600', async () => {
    const res = await fetch(`${baseUrl}/api/public/stats`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(PUBLIC_STATS_CACHE_CONTROL);
    expect(((await res.json()) as { data: { traders: number } }).data.traders).toBeGreaterThanOrEqual(0);
  });

  it('pas de cache public sur une route qui ne l’a pas demandé', async () => {
    const res = await fetch(`${baseUrl}/api/public/visit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.headers.get('cache-control') ?? '').not.toContain('public');
  });
});
