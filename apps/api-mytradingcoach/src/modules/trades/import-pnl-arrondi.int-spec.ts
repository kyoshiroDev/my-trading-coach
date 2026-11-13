/**
 * B1 (#981, audit des chiffres) : le P&L stocké d'un trade est arrondi au centime par `roundCents`.
 * Le P&L entre dans la clé de dédoublonnage : les trades importés AVANT B1 gardent leur valeur brute
 * (MT5 : profit + commission + swap = 12,2856), et un ré-import ne doit jamais les recréer.
 *
 * Test d'intégration (vraie base, vrai HTTP, vrai parseur MT5) : la clé d'unicité en base et la lecture
 * des trades existants sont justement ce qu'on vérifie.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';

const PREFIX = 'int-import-pnl-arrondi-';

let app: INestApplication;
let prisma: PrismaService;
let baseUrl: string;

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

// Export MT5 : P&L = profit + commission + swap, dont la somme flottante a des fractions de centime.
const MT5_CSV = [
  'Ticket,Open Time,Type,Lots,Symbol,Open Price,S/L,T/P,Close Time,Close Price,Commission,Swap,Profit',
  '1001,2026.06.01 09:00:00,buy,0.10,EURUSD,1.10000,0,0,2026.06.01 10:00:00,1.10500,-0.07,0.01,12.3456',
  '1002,2026.06.01 11:00:00,sell,0.20,GBPUSD,1.25000,0,0,2026.06.01 12:00:00,1.24800,-0.14,-0.02,40.005',
].join('\n');
// Sommes brutes, telles que stockées AVANT B1, et leur valeur au centime.
const BRUT = [12.3456 + -0.07 + 0.01, 40.005 + -0.14 + -0.02];

async function registerUser(email: string): Promise<{ id: string; token: string }> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'int-test-no-login-1234', name: 'Int Arrondi' }),
  });
  if (!res.ok) throw new Error(`register → ${res.status} : ${await res.text()}`);
  const body = (await res.json()) as { data: { access_token: string; user: { id: string } } };
  return { id: body.data.user.id, token: body.data.access_token };
}

async function importCsv(token: string): Promise<{ created: number; duplicates: number; failed: number }> {
  const form = new FormData();
  form.append('file', new Blob([MT5_CSV], { type: 'text/csv' }), 'mt5.csv');
  const res = await fetch(`${baseUrl}/api/trades/import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error(`import → ${res.status} : ${await res.text()}`);
  return ((await res.json()) as { data: { created: number; duplicates: number; failed: number } }).data;
}

beforeAll(async () => {
  ({ app, baseUrl } = await createIntegrationApp());
  prisma = app.get(PrismaService);
}, 120_000);

afterAll(async () => {
  if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await app?.close().catch(() => undefined);
});

describe('Import : P&L stocké au centime (B1, #981)', () => {
  it('le P&L importé est stocké arrondi par roundCents, et le ré-import ne recrée rien', async () => {
    const { id: userId, token } = await registerUser(`${PREFIX}seq-${uid()}@test.local`);
    expect(BRUT.map((x) => Math.abs(x * 100 - Math.round(x * 100)) > 1e-6)).toEqual([true, true]); // fractions de centime

    expect(await importCsv(token)).toMatchObject({ created: 2, failed: 0 });
    const trades = await prisma.trade.findMany({ where: { userId }, orderBy: { asset: 'asc' } });
    expect(trades.map((t) => [t.asset, t.pnl])).toEqual([['EUR/USD', 12.29], ['GBP/USD', 39.85]]);

    expect(await importCsv(token)).toMatchObject({ created: 0, duplicates: 2 });
    expect(await prisma.trade.count({ where: { userId } })).toBe(2);
  }, 90_000);

  it('trade stocké AVANT B1 avec l’ancien arrondi toFixed (1 centime de moins) : le ré-import ne le recrée pas', async () => {
    const { id: userId, token } = await registerUser(`${PREFIX}avant-${uid()}@test.local`);
    await importCsv(token);
    // État d'avant B1 : l'ancien `+x.toFixed(2)` (mapper Tradovate, calculatePnl) arrondissait la
    // valeur BINAIRE : 39,845 → 39,84, quand roundCents donne 39,85. Empreinte calculée sur ce P&L.
    const gbp = await prisma.trade.findFirstOrThrow({ where: { userId, asset: 'GBP/USD' } });
    const ancien = +BRUT[1].toFixed(2);
    expect(ancien).toBe(39.84);
    const empreinte = [gbp.asset, gbp.side, gbp.tradedAt.toISOString(), gbp.entry, gbp.exit, ancien].join('|');
    await prisma.trade.update({ where: { id: gbp.id }, data: { pnl: ancien, importHash: empreinte } });

    expect(await importCsv(token)).toMatchObject({ created: 0, duplicates: 2, failed: 0 });
    expect(await prisma.trade.count({ where: { userId } })).toBe(2);
  }, 90_000);
});
