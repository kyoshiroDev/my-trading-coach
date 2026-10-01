/**
 * aucun test d'intégration n'envoie de vrai email.
 *
 * Les `*.int-spec.ts` démarraient `AppModule` tel quel ; en local ils lisaient le `.env` du
 * développeur (vraie clé Resend) et chaque run envoyait de vrais emails. Trois verrous :
 *  1. à l'exécution : construire le VRAI ResendService lève dans cette suite (filet
 *     `integration.setup.ts`, indépendant de NODE_ENV et du `.env`) ;
 *  2. statique : aucun `*.int-spec.ts` ne démarre `AppModule` sans `createIntegrationApp()` ;
 *  3. câblage : l'app du helper injecte le double, et un email déclenché reste observable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ResendService } from '../modules/resend/resend.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../modules/infra/redis.service';
import { REAL_RESEND_FORBIDDEN } from './integration.setup';
import { createIntegrationApp, createResendMock, type ResendMock } from './integration-app.helper';

const SRC = join(__dirname, '..');
const PREFIX = 'int-resend-neutralized-';

function intSpecs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return intSpecs(p);
    return name.endsWith('.int-spec.ts') ? [p] : [];
  });
}

describe('Resend neutralisé — verrous statiques et d’exécution', () => {
  it('le VRAI ResendService ne peut pas être construit dans la suite d’intégration', () => {
    const config = { getOrThrow: () => 're_une_vraie_cle', get: () => undefined } as unknown as ConfigService;
    expect(() => new ResendService(config, {} as RedisService)).toThrow(REAL_RESEND_FORBIDDEN);
  });

  it('aucun *.int-spec.ts ne démarre AppModule sans createIntegrationApp()', () => {
    const offenders = intSpecs(SRC)
      .filter((f) => /createTestingModule\(\s*\{\s*imports:\s*\[\s*AppModule/.test(readFileSync(f, 'utf-8')))
      .map((f) => relative(SRC, f));
    expect(offenders, 'Bootstrap direct d’AppModule : passer par createIntegrationApp()').toEqual([]);
  });

  it('le double couvre TOUTES les méthodes publiques de ResendService (dérivé du prototype)', () => {
    const methods = Object.getOwnPropertyNames(ResendService.prototype).filter((m) => m !== 'constructor');
    const mock = createResendMock();
    expect(Object.keys(mock).sort()).toEqual(methods.sort());
    expect(methods).toContain('sendWelcomeFree');
    expect(methods).toContain('send');
  });
});

describe('Resend neutralisé — app de test réelle', () => {
  let app: INestApplication;
  let baseUrl: string;
  let resend: ResendMock;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, baseUrl, resend } = await createIntegrationApp());
    prisma = app.get(PrismaService);
  }, 120_000);

  afterAll(async () => {
    if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await app?.close().catch(() => undefined);
  });

  it('ResendService injecté = le double du helper', () => {
    expect(app.get(ResendService)).toBe(resend);
  });

  it('une inscription déclenche l’email de bienvenue… sur le double, sans réseau', async () => {
    const email = `${PREFIX}${Date.now().toString(36)}@test.local`;
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'int-test-no-login-1234', name: 'Int Resend' }),
    });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    expect(resend.sendWelcomeFree).toHaveBeenCalledWith(expect.objectContaining({ to: email }));
  });
});
