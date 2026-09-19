/**
 * PROMPT-186 #3 — deux inscriptions concurrentes : 409, jamais 500.
 *
 * Constat navigateur (PROMPT-184) : un double-clic sur « S'inscrire » renvoyait
 * `500 Internal server error` sur le tout premier geste du nouvel utilisateur.
 * `register` faisait `findUnique` puis `create` : les deux requêtes passaient le
 * test d'existence, et la seconde violait `User_email_key` → P2002 non rattrapé.
 * Le front sait déjà afficher un 409 (« Un compte existe déjà avec cette adresse »).
 *
 * Test d'intégration : c'est la concurrence réelle sur la contrainte de base qui
 * est vérifiée, ce qu'un mock ne peut pas prouver.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';

const PREFIX = 'int-register-concurrent-';

let app: INestApplication;
let prisma: PrismaService;
let baseUrl: string;

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

function register(email: string) {
  return fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'int-test-no-login-1234', name: 'Int Concurrent' }),
  });
}

beforeAll(async () => {
  // Bootstrap partagé : ResendService neutralisé (PROMPT-209), aucun vrai email envoyé.
  ({ app, baseUrl } = await createIntegrationApp());
  prisma = app.get(PrismaService);
}, 120_000);

afterAll(async () => {
  if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await app?.close().catch(() => undefined);
});

describe("Inscription — double soumission", () => {
  it('deux register SIMULTANÉS → un 2xx, un 409, aucun 500, aucun doublon', async () => {
    const email = `${PREFIX}${uid()}@test.local`;

    const [a, b] = await Promise.all([register(email), register(email)]);
    const statuses = [a.status, b.status].sort();

    expect(
      statuses.some((s) => s >= 500),
      `Un double-clic ne doit jamais produire un 5xx (reçu ${statuses.join(' / ')})`,
    ).toBe(false);
    expect(statuses.filter((s) => s < 400)).toHaveLength(1);
    expect(
      statuses.filter((s) => s === 409),
      'Le perdant de la course doit recevoir le 409 que le front sait afficher',
    ).toHaveLength(1);

    expect(await prisma.user.count({ where: { email } })).toBe(1);
  }, 60_000);

  it('inscription séquentielle sur un email déjà pris → 409 (chemin nominal inchangé)', async () => {
    const email = `${PREFIX}seq-${uid()}@test.local`;

    expect((await register(email)).ok).toBe(true);
    expect((await register(email)).status).toBe(409);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  }, 60_000);
});