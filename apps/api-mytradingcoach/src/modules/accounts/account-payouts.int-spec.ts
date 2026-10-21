/**
 * Payouts saisis à la main (POST/GET/DELETE /accounts/:id/payouts), sur la vraie base : le payout
 * est retiré du solde du compte et de sa marge, apparaît dans la courbe d'équité journalière, fixe
 * le cycle du prochain payout, et se supprime. Compte connecté au broker : refusé (409).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { AccountType, BrokerProvider, DrawdownType } from '@prisma/client';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';

const PREFIX = 'int-payouts-';
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;

async function register(): Promise<{ id: string; token: string }> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${PREFIX}${uid()}@test.local`, password: 'int-test-no-login-1234', name: 'Int Payouts' }),
  });
  if (!res.ok) throw new Error(`register → ${res.status} : ${await res.text()}`);
  const { data } = (await res.json()) as { data: { access_token: string; user: { id: string } } };
  return { id: data.user.id, token: data.access_token };
}

/** Compte funded de 50 000 $ (drawdown statique 2 000 $) avec +3 000 $ de trades. */
async function fundedAccount(userId: string) {
  const setup = await prisma.setup.create({ data: { userId, title: `S-${uid()}`, color: '#10b981', sortOrder: 0 } });
  const acc = await prisma.tradingAccount.create({
    data: {
      userId, label: `Funded ${uid()}`, type: AccountType.FUNDED, accountSize: 50_000, startingBalance: 50_000,
      maxDrawdown: 2_000, drawdownType: DrawdownType.STATIC,
    },
  });
  for (const pnl of [1_500, 1_500]) {
    await prisma.trade.create({
      data: {
        userId, accountId: acc.id, setupId: setup.id, asset: 'NQ', side: 'LONG', entry: 1, exit: 2, pnl, commission: 0,
        session: 'NEW_YORK', timeframe: 'M5', tags: [], tradedAt: new Date(Date.now() - 3 * 86_400_000),
      },
    });
  }
  return acc;
}

const http = (token: string, method: string, path: string, body?: unknown) =>
  fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const accountOf = async (token: string, id: string) => {
  const res = await http(token, 'GET', '/accounts');
  const { data } = (await res.json()) as { data: { id: string; metrics: { currentBalance: number; drawdown: { margin: number; floor: number } | null } }[] };
  return data.find((a) => a.id === id)!;
};

beforeAll(async () => {
  ({ app, baseUrl } = await createIntegrationApp());
  prisma = app.get(PrismaService);
}, 120_000);

afterAll(async () => {
  if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await app?.close().catch(() => undefined);
});

describe('payouts saisis à la main', () => {
  it('retiré du solde et de la marge, visible dans la courbe, puis supprimé', async () => {
    const me = await register();
    const acc = await fundedAccount(me.id);
    const before = await accountOf(me.token, acc.id);
    expect(before.metrics.currentBalance).toBe(53_000);
    expect(before.metrics.drawdown).toMatchObject({ floor: 48_000, margin: 5_000 });

    const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const add = await http(me.token, 'POST', `/accounts/${acc.id}/payouts`, { tradeDate: day, amount: 1_000 });
    expect(add.status).toBe(201);
    const { data: created } = (await add.json()) as { data: { id: string; manual: boolean } };
    expect(created.manual).toBe(true);

    const after = await accountOf(me.token, acc.id);
    expect(after.metrics.currentBalance).toBe(52_000);
    expect(after.metrics.drawdown).toMatchObject({ floor: 48_000, margin: 4_000 });

    const curve = await http(me.token, 'GET', `/analytics/equity-curve/daily?accountId=${acc.id}`);
    const { data: c } = (await curve.json()) as { data: { payouts?: { date: string; amount: number }[] } };
    expect(c.payouts).toEqual([expect.objectContaining({ amount: 1_000 })]);

    const list = await http(me.token, 'GET', `/accounts/${acc.id}/payouts`);
    expect(((await list.json()) as { data: unknown[] }).data).toEqual([
      expect.objectContaining({ id: created.id, tradeDate: day, amount: 1_000, manual: true }),
    ]);

    expect((await http(me.token, 'DELETE', `/accounts/${acc.id}/payouts/${created.id}`)).status).toBe(200);
    expect((await accountOf(me.token, acc.id)).metrics.currentBalance).toBe(53_000);
  });

  it('refusé sur un compte connecté au broker (409) et pour un autre utilisateur (404)', async () => {
    const me = await register();
    const other = await register();
    const acc = await fundedAccount(me.id);
    const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    expect((await http(other.token, 'POST', `/accounts/${acc.id}/payouts`, { tradeDate: day, amount: 500 })).status).toBe(404);

    await prisma.brokerConnection.create({
      data: { userId: me.id, accountId: acc.id, provider: BrokerProvider.TRADOVATE, accessTokenEnc: 'x', accessTokenExpiresAt: new Date() },
    });
    expect((await http(me.token, 'POST', `/accounts/${acc.id}/payouts`, { tradeDate: day, amount: 500 })).status).toBe(409);
    expect(await prisma.brokerPayout.count({ where: { accountId: acc.id } })).toBe(0);
  });

  it('validation : date future ou montant nul → 400', async () => {
    const me = await register();
    const acc = await fundedAccount(me.id);
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect((await http(me.token, 'POST', `/accounts/${acc.id}/payouts`, { tradeDate: tomorrow, amount: 500 })).status).toBe(400);
    expect((await http(me.token, 'POST', `/accounts/${acc.id}/payouts`, { tradeDate: '2026-10-01', amount: 0 })).status).toBe(400);
  });
});
