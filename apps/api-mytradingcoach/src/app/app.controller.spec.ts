import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppController } from './app.controller';

// Verrouille le contrat de routing SEO (PROMPT-172) : robots.txt à la RACINE du sous-domaine,
// health conservé sous /api. On monte un app minimal (juste AppController, aucune DB / guard global)
// avec le même setGlobalPrefix + exclude que main.ts.
describe('AppController — routing SEO (robots.txt / health)', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['robots.txt'] });
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /robots.txt → 200, text/plain, bloque tout le sous-domaine', async () => {
    const r = await fetch(`${base}/robots.txt`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/plain');
    expect(await r.text()).toBe('User-agent: *\nDisallow: /\n');
  });

  it('GET /api/robots.txt → 404 (robots exclu du préfixe global)', async () => {
    const r = await fetch(`${base}/api/robots.txt`);
    expect(r.status).toBe(404);
  });

  it('GET /api/health → 200 (health reste sous /api, non déplacé)', async () => {
    const r = await fetch(`${base}/api/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: 'ok' });
  });

  it('GET /health → 404 (health non exposé à la racine)', async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(404);
  });
});
