import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { vi, type Mock } from 'vitest';
import { AppModule } from '../app/app.module';
import { ResendService } from '../modules/resend/resend.service';

/**
 * Bootstrap UNIQUE des tests d'intégration (PROMPT-209). Tout `*.int-spec.ts` qui démarre
 * `AppModule` passe par ici, jamais par un `Test.createTestingModule({ imports: [AppModule] })`
 * direct (règle `.claude/agents/tests.md`).
 *
 * Pourquoi : en local, ces tests lisent le `.env` du développeur, qui porte une VRAIE clé
 * Resend. Chaque run envoyait de vrais emails (inscription, reset…) et consommait le quota.
 * `ResendService` est donc remplacé par un double dont chaque méthode est un `vi.fn()` résolu
 * — les tests peuvent toujours vérifier qu'un email a été DÉCLENCHÉ, sans appel réseau.
 *
 * Filet : `integration.setup.ts` fait lever le SDK Resend s'il est construit malgré tout.
 */

/** Double de ResendService : toutes ses méthodes publiques, en no-op observables. */
export type ResendMock = { [K in keyof ResendService]: Mock };

/**
 * Construit le double depuis le PROTOTYPE de la classe : une méthode ajoutée demain à
 * ResendService est neutralisée d'office, sans liste à maintenir (une seule source de vérité).
 */
export function createResendMock(): ResendMock {
  const mock: Record<string, Mock> = {};
  for (const name of Object.getOwnPropertyNames(ResendService.prototype)) {
    if (name === 'constructor') continue;
    const d = Object.getOwnPropertyDescriptor(ResendService.prototype, name);
    if (typeof d?.value === 'function') mock[name] = vi.fn().mockResolvedValue(undefined);
  }
  return mock as ResendMock;
}

export interface IntegrationAppOptions {
  /** Surcharges supplémentaires du module de test (ex. stockage du throttler). */
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
  /**
   * Réglages de l'app avant `init()` (pipes, cookies, exclusions de préfixe…).
   * Défaut : `setGlobalPrefix('api')`, comme les specs d'origine.
   */
  setup?: (app: INestApplication) => void;
}

export interface IntegrationApp {
  app: INestApplication;
  /** URL de base du serveur HTTP de test (port libre). */
  baseUrl: string;
  /** Le double injecté à la place de ResendService, pour inspecter les envois déclenchés. */
  resend: ResendMock;
}

export async function createIntegrationApp(opts: IntegrationAppOptions = {}): Promise<IntegrationApp> {
  const resend = createResendMock();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ResendService)
    .useValue(resend);
  if (opts.configure) builder = opts.configure(builder);

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  if (opts.setup) opts.setup(app);
  else app.setGlobalPrefix('api');
  await app.init();
  await app.listen(0);
  return { app, baseUrl: await app.getUrl(), resend };
}
