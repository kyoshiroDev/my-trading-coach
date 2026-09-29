/**
 * régression Val : import CSV rejeté par un `setupId` périmé.
 *
 * Constat terrain (2026-08-18) : le wizard d'onboarding fixait `setupId` sur le
 * PREMIER setup actif au montage du composant CSV import (étape 1) sans jamais
 * le revalider. En supprimant ce setup à l'étape « Tes setups » (7),
 * l'utilisateur envoyait un id fantôme à l'étape 8 → 400 sur TOUT le lot, alors
 * qu'il lui restait des setups actifs.
 *
 * Comportement corrigé, vérifié ici : un `setupId` invalide
 * (archivé ou hors compte) est traité comme absent — l'import retombe sur
 * « Sans setup » (`resolveBatchSetupId` → `getImportSetupId`) au
 * lieu de rejeter le lot. Un `setupId` valide reste évidemment respecté.
 *
 * Nécessite une vraie base : c'est `TradesController` (guard + interceptor
 * multer + services réels) qui est exercé, pas `CsvImportService` seul —
 * lequel n'a jamais vu passer le `setupId`, la validation vit dans le
 * controller. Un mock de `SetupsService` ne prouverait donc rien ici.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { IMPORT_SETUP_TITLE } from '../setups/setups.service';

const PREFIX = 'int-setup-fallback-';

let app: INestApplication;
let prisma: PrismaService;
let baseUrl: string;

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

// Export MEXC minimal (1 trade fermé) : format déjà validé par
// csv-import.service.spec.ts, suffit à exercer tout le tunnel d'import.
const MEXC_HEADER =
  'Futures;Open Time;Close Time;Margin Mode;Avg Entry Price;Avg Close Price;Direction;Closing Qty (Cont.);Trading Fee;Realized PNL;Status;UID';
const MEXC_ROW =
  'BTCUSDT;2026-05-30 12:11:40;2026-05-30 14:31:55;Isolated;73,602.51;73,692.56;Short;550;1.6202459USDT;-6.5727459USDT;All Closed;65370223';
const MEXC_CSV = [MEXC_HEADER, MEXC_ROW].join('\r\n');

interface RegisterResponse {
  data: { access_token: string; user: { id: string } };
}

async function registerUser(email: string): Promise<{ id: string; token: string }> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'int-test-no-login-1234', name: 'Int Setup Fallback' }),
  });
  if (!res.ok) {
    throw new Error(`register ${email} → ${res.status} : ${await res.text()}`);
  }
  const body = (await res.json()) as RegisterResponse;
  return { id: body.data.user.id, token: body.data.access_token };
}

/** Upload multipart réel (Node fetch/FormData, comme un vrai client). */
async function importCsv(token: string, setupId: string) {
  const form = new FormData();
  form.append('file', new Blob([MEXC_CSV], { type: 'text/csv' }), 'mexc.csv');
  form.append('setupId', setupId);
  return fetch(`${baseUrl}/api/trades/import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
}

beforeAll(async () => {
  // Bootstrap partagé : ResendService neutralisé, aucun vrai email envoyé.
  ({ app, baseUrl } = await createIntegrationApp());
  prisma = app.get(PrismaService);
}, 120_000);

afterAll(async () => {
  if (prisma) {
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  }
  await app?.close().catch(() => undefined);
});

/** Titre du setup du premier trade importé du user. */
async function importedSetupTitle(userId: string): Promise<string | undefined> {
  const trade = await prisma.trade.findFirst({ where: { userId }, include: { setup: true } });
  return trade?.setup.title;
}

describe('Import CSV — setupId périmé (régression Val)', () => {
  it('setup ARCHIVÉ → import retombe sur « Sans setup » au lieu de rejeter le lot', async () => {
    const s = uid();
    const email = `${PREFIX}archived-${s}@test.local`;
    const { id: userId, token } = await registerUser(email);

    // Les 6 setups par défaut sont seedés au register (sortOrder 0..5, "Breakout" en tête).
    const defaults = await prisma.setup.findMany({
      where: { userId },
      orderBy: { sortOrder: 'asc' },
    });
    expect(defaults.length, 'Le register aurait dû seeder les 6 setups par défaut').toBe(6);
    const [stale] = defaults; // Breakout (archivé)

    // Reproduit exactement le bug Val : le wizard tenait encore l'id du 1er setup,
    // supprimé/archivé entre-temps à l'étape "Tes setups".
    await prisma.setup.update({ where: { id: stale.id }, data: { archived: true } });

    const res = await importCsv(token, stale.id);
    expect(
      res.ok,
      `Import rejeté (${res.status}) alors qu'il devrait retomber sur le setup par défaut : ${await res.text()}`,
    ).toBe(true);

    const trade = await prisma.trade.findFirst({ where: { userId } });
    expect(trade, 'Aucun trade créé : le lot entier a été rejeté').toBeTruthy();
    expect(trade!.setupId, "pas l'id périmé").not.toBe(stale.id);
    expect(await importedSetupTitle(userId)).toBe(IMPORT_SETUP_TITLE);
  });

  it('setup HORS COMPTE → import retombe sur « Sans setup » au lieu de rejeter le lot', async () => {
    const s = uid();
    const emailA = `${PREFIX}victim-${s}@test.local`;
    const emailB = `${PREFIX}other-${s}@test.local`;
    const { id: userA, token: tokenA } = await registerUser(emailA);
    await registerUser(emailB); // seed ses propres setups, jamais utilisé pour l'appel

    const otherUserSetup = await prisma.setup.findFirst({
      where: { user: { email: emailB } },
      orderBy: { sortOrder: 'asc' },
    });
    expect(otherUserSetup, "Setup de l'autre user introuvable").toBeTruthy();

    const res = await importCsv(tokenA, otherUserSetup!.id);
    expect(
      res.ok,
      `Import rejeté (${res.status}) alors qu'un setupId hors compte devrait juste être ignoré : ${await res.text()}`,
    ).toBe(true);

    const trade = await prisma.trade.findFirst({ where: { userId: userA } });
    expect(trade, 'Aucun trade créé : le lot entier a été rejeté').toBeTruthy();
    expect(await importedSetupTitle(userA)).toBe(IMPORT_SETUP_TITLE);

    // Le setup d'autrui ne doit évidemment jamais être utilisé.
    expect(trade!.setupId).not.toBe(otherUserSetup!.id);
  });

  it('setup VALIDE → respecté (le repli ne s\'applique qu\'aux id périmés)', async () => {
    const s = uid();
    const email = `${PREFIX}valid-${s}@test.local`;
    const { id: userId, token } = await registerUser(email);

    // Un setup explicite qui n'est PAS le défaut (sortOrder le plus bas) : si le
    // repli s'appliquait à tort, le trade atterrirait sur "Breakout" (sortOrder 0).
    const setups = await prisma.setup.findMany({ where: { userId }, orderBy: { sortOrder: 'asc' } });
    const chosen = setups[3];

    const res = await importCsv(token, chosen.id);
    expect(res.ok, `Import rejeté (${res.status}) avec un setup pourtant valide`).toBe(true);

    const trade = await prisma.trade.findFirst({ where: { userId } });
    expect(trade!.setupId, `Le setup choisi (${chosen.title}) doit être respecté`).toBe(chosen.id);
  });

  it('AUCUN setup actif → « Sans setup » est créé et le trade importé', async () => {
    const s = uid();
    const email = `${PREFIX}nosetup-${s}@test.local`;
    const { id: userId, token } = await registerUser(email);

    const setups = await prisma.setup.findMany({ where: { userId } });
    const stale = setups[0].id;
    // Cas dégénéré atteignable via l'API (archivage/suppression sans minimum imposé
    // côté back) : plus aucun setup actif. Tant que la FK était NOT NULL, celle de
    // `Trade.setupId` faisait compter le trade en échec ; « Sans setup » est
    // désormais créé à la volée, le trade passe.
    await prisma.setup.updateMany({ where: { userId }, data: { archived: true } });

    const res = await importCsv(token, stale);
    expect(res.ok, `L'import ne doit pas être rejeté : ${await res.clone().text()}`).toBe(true);

    const body = (await res.json()) as { data: { created: number; failed: number } };
    expect(body.data.created).toBe(1);
    expect(body.data.failed).toBe(0);
    expect(await importedSetupTitle(userId)).toBe(IMPORT_SETUP_TITLE);
  });
});