/**
 * PROMPT-186 #1 — deux imports CONCURRENTS du même fichier ne doivent créer qu'un
 * seul historique.
 *
 * Constat navigateur (PROMPT-184) : un double-clic sur « Importer » produisait
 * 40 trades au lieu de 20, avec P&L et frais doublés, sans aucun signal. La dédup
 * était applicative (lire tous les trades, comparer, insérer) : les deux requêtes
 * lisaient le même état vide avant d'écrire. Aucun verrou UI ne peut corriger ça de
 * façon fiable — seule une contrainte d'unicité en base tranche, quel que soit le
 * timing. D'où `@@unique([userId, importHash])`.
 *
 * Test d'intégration (vraie base, vrai HTTP) : c'est justement la concurrence réelle
 * qu'on vérifie, ce qu'un mock ne peut pas prouver.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';

const PREFIX = 'int-import-concurrent-';

let app: INestApplication;
let prisma: PrismaService;
let baseUrl: string;

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

const PERF_CSV = readFileSync(join(__dirname, '__fixtures__', 'tradovate-performance.csv'));
const EXPECTED_TRADES = 20; // prouvé par csv-import.service.spec.ts sur la même fixture

async function registerUser(email: string): Promise<{ id: string; token: string }> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'int-test-no-login-1234', name: 'Int Concurrent' }),
  });
  if (!res.ok) throw new Error(`register → ${res.status} : ${await res.text()}`);
  const body = (await res.json()) as { data: { access_token: string; user: { id: string } } };
  return { id: body.data.user.id, token: body.data.access_token };
}

function importCsv(token: string) {
  const form = new FormData();
  form.append('file', new Blob([PERF_CSV], { type: 'text/csv' }), 'Performance.csv');
  return fetch(`${baseUrl}/api/trades/import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
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

describe('Import CSV — concurrence (double-clic)', () => {
  it('deux imports SIMULTANÉS du même fichier → un seul historique', async () => {
    const email = `${PREFIX}dbl-${uid()}@test.local`;
    const { id: userId, token } = await registerUser(email);

    // Le double-clic : les deux requêtes partent avant que la première ait écrit.
    const [a, b] = await Promise.all([importCsv(token), importCsv(token)]);
    expect(a.status, `1er import rejeté : ${await a.clone().text()}`).toBeLessThan(400);
    expect(b.status, `2e import rejeté : ${await b.clone().text()}`).toBeLessThan(400);

    const total = await prisma.trade.count({ where: { userId } });
    expect(
      total,
      `Historique dupliqué : ${total} trades au lieu de ${EXPECTED_TRADES} (P&L et frais faussés)`,
    ).toBe(EXPECTED_TRADES);

    // Le lot en double est compté comme doublon, pas comme échec.
    const bodies = (await Promise.all([a.json(), b.json()])) as {
      data: { created: number; duplicates: number; failed: number };
    }[];
    const created = bodies.reduce((s, r) => s + r.data.created, 0);
    const failed = bodies.reduce((s, r) => s + r.data.failed, 0);
    expect(created, 'Au total, exactement un jeu de trades créé').toBe(EXPECTED_TRADES);
    expect(failed, 'Un doublon concurrent ne doit pas être compté en échec').toBe(0);
  }, 90_000);

  it('ré-import séquentiel du même fichier → toujours aucun doublon', async () => {
    const email = `${PREFIX}seq-${uid()}@test.local`;
    const { id: userId, token } = await registerUser(email);

    const first = await importCsv(token);
    expect(first.ok).toBe(true);
    const second = await importCsv(token);
    expect(second.ok).toBe(true);

    expect(await prisma.trade.count({ where: { userId } })).toBe(EXPECTED_TRADES);
    const body = (await second.json()) as { data: { created: number; duplicates: number } };
    expect(body.data.created).toBe(0);
    expect(body.data.duplicates).toBe(EXPECTED_TRADES);
  }, 90_000);

  it('la saisie manuelle n\'est PAS contrainte : deux trades identiques restent créables', async () => {
    const email = `${PREFIX}manual-${uid()}@test.local`;
    const { id: userId, token } = await registerUser(email);
    const setup = await prisma.setup.findFirst({ where: { userId }, orderBy: { sortOrder: 'asc' } });

    const payload = {
      asset: 'BTC/USDT', side: 'LONG', entry: 50000, exit: 51000,
      setupId: setup!.id, session: 'LONDON', timeframe: '1h',
      tradedAt: new Date('2026-08-01T10:00:00Z').toISOString(),
    };
    const post = () =>
      fetch(`${baseUrl}/api/trades`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });

    expect((await post()).ok).toBe(true);
    const second = await post();
    expect(
      second.ok,
      'Deux scalps identiques à la même seconde doivent rester possibles (importHash null)',
    ).toBe(true);
    expect(await prisma.trade.count({ where: { userId } })).toBe(2);
  }, 90_000);
});