/**
 * #1001 (N2 de l'audit #994) : dédoublonnage PAR COMPTE. Décision de Greg (15/11, recommandation du
 * relecteur) : le même trade copié sur deux comptes (copy trading) = deux trades, un par compte.
 *
 * Avant : l'empreinte ignorait le compte. Importer l'historique du compte A puis le même historique
 * dans le compte B donnait « 0 créé, N doublons » : B restait vide (drawdown, règles prop faux).
 * « Supprimer les doublons » effaçait aussi d'un compte à l'autre.
 *
 * Test d'intégration (vraie base, vrai HTTP, vrai parseur MT5) : l'index `@@unique([userId, importHash])`
 * est inchangé, c'est l'empreinte préfixée par le compte qui doit passer.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';

const PREFIX = 'int-import-par-compte-';

let app: INestApplication;
let prisma: PrismaService;
let baseUrl: string;

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

const MT5_CSV = [
  'Ticket,Open Time,Type,Lots,Symbol,Open Price,S/L,T/P,Close Time,Close Price,Commission,Swap,Profit',
  '1001,2026.06.01 09:00:00,buy,0.10,EURUSD,1.10000,0,0,2026.06.01 10:00:00,1.10500,0,0,50',
  '1002,2026.06.01 11:00:00,sell,0.20,GBPUSD,1.25000,0,0,2026.06.01 12:00:00,1.24800,0,0,40',
].join('\n');

type ImportResult = {
  created: number;
  duplicates: number;
  failed: number;
  alsoInOtherAccounts: { accountId: string; name: string; count: number }[];
};

async function registerUser(email: string): Promise<{ id: string; token: string }> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'int-test-no-login-1234', name: 'Int Par Compte' }),
  });
  if (!res.ok) throw new Error(`register → ${res.status} : ${await res.text()}`);
  const body = (await res.json()) as { data: { access_token: string; user: { id: string } } };
  return { id: body.data.user.id, token: body.data.access_token };
}

async function importCsv(token: string, accountId: string): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', new Blob([MT5_CSV], { type: 'text/csv' }), 'mt5.csv');
  form.append('accountId', accountId);
  const res = await fetch(`${baseUrl}/api/trades/import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error(`import → ${res.status} : ${await res.text()}`);
  return ((await res.json()) as { data: ImportResult }).data;
}

function duplicates(token: string, method: 'GET' | 'DELETE') {
  return fetch(`${baseUrl}/api/trades/duplicates`, { method, headers: { authorization: `Bearer ${token}` } }).then(
    async (r) => ((await r.json()) as { data: Record<string, number> }).data,
  );
}

beforeAll(async () => {
  ({ app, baseUrl } = await createIntegrationApp());
  prisma = app.get(PrismaService);
}, 120_000);

afterAll(async () => {
  if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await app?.close().catch(() => undefined);
});

describe('Import : dédoublonnage par compte (#1001)', () => {
  it('copy trading : le même historique importé dans A puis dans B crée les trades dans chacun', async () => {
    const { id: userId, token } = await registerUser(`${PREFIX}${uid()}@test.local`);
    const a = await prisma.tradingAccount.create({ data: { userId, label: 'Apex 50k #1' } });
    const b = await prisma.tradingAccount.create({ data: { userId, label: 'Apex 50k #2' } });

    expect(await importCsv(token, a.id)).toMatchObject({ created: 2, duplicates: 0, failed: 0, alsoInOtherAccounts: [] });

    // Avant #1001 : { created: 0, duplicates: 2 } et B restait vide.
    expect(await importCsv(token, b.id)).toMatchObject({
      created: 2,
      duplicates: 0,
      failed: 0,
      alsoInOtherAccounts: [{ accountId: a.id, name: 'Apex 50k #1', count: 2 }],
    });
    expect(await prisma.trade.count({ where: { userId, accountId: a.id } })).toBe(2);
    expect(await prisma.trade.count({ where: { userId, accountId: b.id } })).toBe(2);

    // Ré-import dans chaque compte : rien de recréé (dédoublonnage dans le compte, inchangé).
    expect(await importCsv(token, a.id)).toMatchObject({ created: 0, duplicates: 2 });
    expect(await importCsv(token, b.id)).toMatchObject({ created: 0, duplicates: 2 });
    expect(await prisma.trade.count({ where: { userId } })).toBe(4);
  }, 90_000);

  it('« Supprimer les doublons » ne touche jamais un compte à cause d’un autre', async () => {
    const { id: userId, token } = await registerUser(`${PREFIX}suppr-${uid()}@test.local`);
    const a = await prisma.tradingAccount.create({ data: { userId, label: 'Compte A' } });
    const b = await prisma.tradingAccount.create({ data: { userId, label: 'Compte B' } });
    await importCsv(token, a.id);
    await importCsv(token, b.id);

    expect(await duplicates(token, 'GET')).toMatchObject({ total: 4, duplicates: 0 });
    expect(await duplicates(token, 'DELETE')).toMatchObject({ removed: 0 });
    expect(await prisma.trade.count({ where: { userId } })).toBe(4);

    // Un vrai doublon DANS le compte A (saisie manuelle identique) : seul lui part.
    const t = await prisma.trade.findFirstOrThrow({ where: { userId, accountId: a.id } });
    const { id: _id, importHash: _h, createdAt: _c, ...copy } = t;
    await prisma.trade.create({ data: { ...copy, importHash: null } });
    expect(await duplicates(token, 'GET')).toMatchObject({ duplicates: 1 });
    expect(await duplicates(token, 'DELETE')).toMatchObject({ removed: 1 });
    expect(await prisma.trade.count({ where: { userId, accountId: a.id } })).toBe(2);
    expect(await prisma.trade.count({ where: { userId, accountId: b.id } })).toBe(2);
  }, 90_000);

  it('trade importé AVANT #1001 (empreinte sans compte) : le ré-import dans le même compte ne le recrée pas', async () => {
    const { id: userId, token } = await registerUser(`${PREFIX}avant-${uid()}@test.local`);
    const a = await prisma.tradingAccount.create({ data: { userId, label: 'Compte A' } });
    await importCsv(token, a.id);
    // État d'avant #1001 : empreinte sans le préfixe `a:<compte>|`.
    for (const t of await prisma.trade.findMany({ where: { userId } })) {
      await prisma.trade.update({ where: { id: t.id }, data: { importHash: t.importHash!.replace(/^a:[^|]+\|/, '') } });
    }
    expect(await importCsv(token, a.id)).toMatchObject({ created: 0, duplicates: 2 });
    expect(await prisma.trade.count({ where: { userId } })).toBe(2);
  }, 90_000);

  it('trade importé AVANT #1001 puis modifié (P&L corrigé) : le ré-import dans son compte ne recrée pas l’original', async () => {
    const { id: userId, token } = await registerUser(`${PREFIX}modifie-${uid()}@test.local`);
    const a = await prisma.tradingAccount.create({ data: { userId, label: 'Compte A' } });
    const b = await prisma.tradingAccount.create({ data: { userId, label: 'Compte B' } });
    await importCsv(token, a.id);
    // État d'avant #1001 (empreinte sans préfixe), puis P&L corrigé à la main par le trader.
    for (const t of await prisma.trade.findMany({ where: { userId } })) {
      await prisma.trade.update({
        where: { id: t.id },
        data: { importHash: t.importHash!.replace(/^a:[^|]+\|/, ''), pnl: (t.pnl ?? 0) + 1 },
      });
    }
    expect(await importCsv(token, a.id)).toMatchObject({ created: 0, duplicates: 2 });
    expect(await prisma.trade.count({ where: { userId, accountId: a.id } })).toBe(2);
    // L'empreinte d'un autre compte ne bloque rien : copy trading toujours importé dans B.
    expect(await importCsv(token, b.id)).toMatchObject({ created: 2, duplicates: 0 });
  }, 90_000);
});
