/**
 * Suppression DÉFINITIVE d'un compte de trading (DELETE /accounts/:id/permanent), sur la vraie
 * base : le compte et tout ce qui en dépend disparaissent en une transaction, sans trade orphelin,
 * sans toucher aux autres comptes ni aux autres utilisateurs ; confirmation obligatoire ; démo
 * refusée ; statistiques exactes juste après (cache invalidé).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { AccountStatus, BrokerProvider } from '@prisma/client';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AccountsService } from './accounts.service';

const PREFIX = 'int-purge-';
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let accounts: AccountsService;
let analytics: AnalyticsService;

async function register(): Promise<{ id: string; token: string }> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${PREFIX}${uid()}@test.local`, password: 'int-test-no-login-1234', name: 'Int Purge' }),
  });
  if (!res.ok) throw new Error(`register → ${res.status} : ${await res.text()}`);
  const { data } = (await res.json()) as { data: { access_token: string; user: { id: string } } };
  return { id: data.user.id, token: data.access_token };
}

/** Compte avec 2 trades, une séance, une connexion Tradovate, une clôture, un payout, une alerte. */
async function fullAccount(userId: string, label: string, pnl: number) {
  const setup = await prisma.setup.create({ data: { userId, title: `S-${uid()}`, color: '#10b981', sortOrder: 0 } });
  const acc = await prisma.tradingAccount.create({ data: { userId, label, status: AccountStatus.FAILED } });
  const session = await prisma.tradeSession.create({ data: { userId, accountId: acc.id } as never });
  const trade = (p: number) => prisma.trade.create({
    data: {
      userId, accountId: acc.id, sessionId: session.id, setupId: setup.id, asset: 'NQ', side: 'LONG', entry: 1, exit: 2,
      pnl: p, commission: 0, session: 'NEW_YORK', timeframe: 'M5', tags: ['perdu'], tradedAt: new Date(Date.now() - 60_000),
    },
  });
  const [t1] = await Promise.all([trade(pnl / 2), trade(pnl / 2)]);
  await prisma.brokerConnection.create({
    data: { userId, accountId: acc.id, provider: BrokerProvider.TRADOVATE, accessTokenEnc: 'x', accessTokenExpiresAt: new Date() },
  });
  await prisma.brokerDailyClose.create({
    data: { accountId: acc.id, tradeDate: new Date('2026-10-01'), closingBalance: 49_000, realizedPnl: -1000 },
  });
  await prisma.brokerPayout.create({
    data: { accountId: acc.id, transactionId: `tx-${uid()}`, tradeDate: new Date('2026-10-01'), amount: 500, changeType: 'challengepayout' },
  });
  await prisma.behaviorAlert.create({
    data: {
      userId, accountId: acc.id, tradeId: t1.id, sessionId: session.id,
      tradeDay: new Date('2026-10-01'), type: 'revenge', severity: 'warning', message: 'test',
    },
  });
  return { acc, session };
}

const purgeHttp = (token: string, id: string, body?: unknown) =>
  fetch(`${baseUrl}/api/accounts/${id}/permanent`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  ({ app, baseUrl } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  accounts = app.get(AccountsService);
  analytics = app.get(AnalyticsService);
}, 120_000);

afterAll(async () => {
  if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await app?.close().catch(() => undefined);
});

describe('DELETE /accounts/:id/permanent', () => {
  it('efface le compte, ses trades et tout ce qui en dépend ; aucun orphelin ; le reste intact', async () => {
    const me = await register();
    const other = await register();
    const { acc, session } = await fullAccount(me.id, 'Apex 50K #1', -3000);
    const { acc: keep } = await fullAccount(me.id, 'Topstep 150K', 500);
    const { acc: foreign } = await fullAccount(other.id, 'Apex 50K #1', -3000);

    const res = await purgeHttp(me.token, acc.id, { confirm: true });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toEqual({ deleted: true, tradesDeleted: 2 });

    expect(await prisma.tradingAccount.findUnique({ where: { id: acc.id } })).toBeNull();
    for (const [model, where] of [
      ['trade', { accountId: acc.id }],
      ['tradeSession', { id: session.id }],
      ['brokerConnection', { accountId: acc.id }],
      ['brokerDailyClose', { accountId: acc.id }],
      ['brokerPayout', { accountId: acc.id }],
      ['behaviorAlert', { accountId: acc.id }],
    ] as const) {
      expect(await (prisma[model] as unknown as { count: (a: unknown) => Promise<number> }).count({ where }), model).toBe(0);
    }
    // Aucun trade devenu orphelin (compte supprimé → trade détaché) chez cet utilisateur.
    expect(await prisma.trade.count({ where: { userId: me.id, accountId: null } })).toBe(0);
    // L'autre compte du même utilisateur et le compte d'un autre utilisateur sont intacts.
    expect(await prisma.trade.count({ where: { accountId: keep.id } })).toBe(2);
    expect(await prisma.brokerConnection.count({ where: { accountId: keep.id } })).toBe(1);
    expect(await prisma.trade.count({ where: { accountId: foreign.id } })).toBe(2);
    expect(await prisma.tradingAccount.count({ where: { id: foreign.id } })).toBe(1);
    // Compte MyTradingCoach intact.
    expect(await prisma.user.count({ where: { id: me.id } })).toBe(1);
  });

  it('statistiques exactes juste après (cache invalidé)', async () => {
    const me = await register();
    const { acc } = await fullAccount(me.id, 'Apex 50K #1', -3000);
    await fullAccount(me.id, 'Topstep 150K', 500);
    await prisma.tradingAccount.updateMany({ where: { userId: me.id }, data: { status: AccountStatus.ACTIVE } });
    // Met en cache le total avec les deux comptes actifs : 500 − 3000.
    expect((await analytics.getSummary(me.id)).totalPnl).toBe(-2500);

    await accounts.purge(me.id, acc.id, true);

    expect((await analytics.getSummary(me.id)).totalPnl).toBe(500);
    expect((await analytics.getSummary(me.id, undefined, undefined, undefined, true)).totalPnl).toBe(500);
  });

  it('sans confirmation : 400, rien supprimé', async () => {
    const me = await register();
    const { acc } = await fullAccount(me.id, 'Apex 50K #1', -3000);
    for (const body of [undefined, {}, { confirm: 'true' }, { confirm: false }]) {
      expect((await purgeHttp(me.token, acc.id, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await prisma.trade.count({ where: { accountId: acc.id } })).toBe(2);
  });

  it('compte d’un autre utilisateur : 404, rien supprimé', async () => {
    const me = await register();
    const other = await register();
    const { acc } = await fullAccount(other.id, 'Apex 50K #1', -3000);
    expect((await purgeHttp(me.token, acc.id, { confirm: true })).status).toBe(404);
    expect(await prisma.trade.count({ where: { accountId: acc.id } })).toBe(2);
  });

  it('compte démo : refusé (lecture seule), rien supprimé', async () => {
    const demo = await register();
    await prisma.user.update({ where: { id: demo.id }, data: { isDemo: true } });
    const { acc } = await fullAccount(demo.id, 'Apex 50K #1', -3000);
    expect((await purgeHttp(demo.token, acc.id, { confirm: true })).status).toBe(403);
    expect(await prisma.trade.count({ where: { accountId: acc.id } })).toBe(2);
  });

  it('erreur en cours de transaction : tout est annulé (trades, séance, connexion)', async () => {
    const me = await register();
    const { acc, session } = await fullAccount(me.id, 'Apex 50K #1', -3000);
    const original = prisma.$transaction.bind(prisma);
    const spy = vi.spyOn(prisma, '$transaction').mockImplementationOnce(((fn: (tx: unknown) => Promise<unknown>) =>
      original(async (tx) => fn(new Proxy(tx, {
        get: (t, k) => (k === 'tradingAccount'
          ? { ...t.tradingAccount, delete: async () => { throw new Error('panne simulée'); } }
          : (t as unknown as Record<string | symbol, unknown>)[k]),
      })))) as never);

    await expect(accounts.purge(me.id, acc.id, true)).rejects.toThrow('panne simulée');
    spy.mockRestore();

    expect(await prisma.tradingAccount.count({ where: { id: acc.id } })).toBe(1);
    expect(await prisma.trade.count({ where: { accountId: acc.id } })).toBe(2);
    expect(await prisma.tradeSession.count({ where: { id: session.id } })).toBe(1);
    expect(await prisma.brokerConnection.count({ where: { accountId: acc.id } })).toBe(1);
  });
});
