import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { ResponseInterceptor } from '../common/interceptors/response.interceptor';

// Verrouille le contrat de routing SEO : robots.txt à la RACINE du sous-domaine,
// health conservé sous /api. On enregistre le ResponseInterceptor GLOBAL (comme en prod) pour
// prouver que robots.txt sort en texte BRUT (et non emballé { data: ... }, bug déjà rencontré).
describe('AppController — routing SEO (robots.txt / health)', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: APP_INTERCEPTOR, useClass: ResponseInterceptor }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['robots.txt'] });
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /robots.txt → 200, text/plain, corps BRUT (pas emballé { data })', async () => {
    const r = await fetch(`${base}/robots.txt`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/plain');
    // Corps exactement le robots.txt, PAS {"data":"..."} (contournement du ResponseInterceptor).
    expect(await r.text()).toBe('User-agent: *\nDisallow: /\n');
  });

  it('GET /api/robots.txt → 404 (robots exclu du préfixe global)', async () => {
    const r = await fetch(`${base}/api/robots.txt`);
    expect(r.status).toBe(404);
  });

  it('GET /api/health → 200 (health reste sous /api, emballé par le ResponseInterceptor)', async () => {
    const r = await fetch(`${base}/api/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ data: { status: 'ok' } });
  });

  it('GET /health → 404 (health non exposé à la racine)', async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(404);
  });
});
