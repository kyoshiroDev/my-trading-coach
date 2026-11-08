/**
 * Suppression d'un compte ARCHIVÉ (DELETE /accounts/:id/archived), sur la vraie base : le compte et
 * tous ses trades disparaissent en une transaction, connexion broker comprise ; un compte non
 * archivé ou d'un autre utilisateur est refusé sans rien toucher ; statistiques exactes juste après.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { AccountStatus, BrokerProvider } from '@prisma/client';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';

const PREFIX = 'int-delarc-';
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

let app: INestApplication;
let baseUrl: string;
let prisma: PrismaService;
let analytics: AnalyticsService;

async function register(): Promise<{ id: string; token: string }> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${PREFIX}${uid()}@test.local`, password: 'int-test-no-login-1234', name: 'Int DelArc' }),
  });
  if (!res.ok) throw new Error(`register → ${res.status} : ${await res.text()}`);
  const { data } = (await res.json()) as { data: { access_token: string; user: { id: string } } };
  return { id: data.user.id, token: data.access_token };
}

/** Compte avec 2 trades, une séance, une connexion Tradovate, une clôture, un payout, un incident. */
async function account(userId: string, label: string, status: AccountStatus, pnl: number) {
  const setup = await prisma.setup.create({ data: { userId, title: `S-${uid()}`, color: '#10b981', sortOrder: 0 } });
  const acc = await prisma.tradingAccount.create({ data: { userId, label, status } });
  const session = await prisma.tradeSession.create({ data: { userId, accountId: acc.id } as never });
  const trade = (p: number) => prisma.trade.create({
    data: {
      userId, accountId: acc.id, sessionId: session.id, setupId: setup.id, asset: 'NQ', side: 'LONG', entry: 1, exit: 2,
      pnl: p, commission: 0, session: 'NEW_YORK', timeframe: 'M5', tags: [], tradedAt: new Date(Date.now() - 60_000),
    },
  });
  await Promise.all([trade(pnl / 2), trade(pnl / 2)]);
  await prisma.brokerConnection.create({
    data: { userId, accountId: acc.id, provider: BrokerProvider.TRADOVATE, accessTokenEnc: 'x', accessTokenExpiresAt: new Date() },
  });
  await prisma.brokerDailyClose.create({
    data: { accountId: acc.id, tradeDate: new Date('2026-10-01'), closingBalance: 49_000, realizedPnl: -1000 },
  });
  await prisma.brokerPayout.create({
    data: { accountId: acc.id, transactionId: `tx-${uid()}`, tradeDate: new Date('2026-10-01'), amount: 500, changeType: 'challengepayout' },
  });
  await prisma.accountIncident.create({
    data: { userId, accountId: acc.id, kind: 'manual', period: 'account', tradeDate: new Date('2026-10-01'), source: 'manual' },
  });
  return { acc, session };
}

const deleteHttp = (token: string, id: string, body?: unknown) =>
  fetch(`${baseUrl}/api/accounts/${id}/archived`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  ({ app, baseUrl } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  analytics = app.get(AnalyticsService);
}, 120_000);

afterAll(async () => {
  if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await app?.close().catch(() => undefined);
});

describe('DELETE /accounts/:id/archived', () => {
  it('compte archivé avec trades et connexion broker : tout effacé, aucun orphelin, le reste intact', async () => {
    const me = await register();
    const { acc, session } = await account(me.id, 'Test NT8', AccountStatus.ARCHIVED, -3000);
    const { acc: keep } = await account(me.id, 'Lucid Flex 50K', AccountStatus.ACTIVE, 500);

    const preview = await fetch(`${baseUrl}/api/accounts/${acc.id}/deletion-preview`, { headers: { authorization: `Bearer ${me.token}` } });
    expect(((await preview.json()) as { data: unknown }).data).toEqual({ archived: true, tradesCount: 2, sessionsCount: 1, brokerConnected: true });

    const res = await deleteHttp(me.token, acc.id, { confirm: true });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toEqual({ deleted: true, tradesDeleted: 2 });

    expect(await prisma.tradingAccount.findUnique({ where: { id: acc.id } })).toBeNull();
    for (const [model, where] of [
      ['trade', { accountId: acc.id }],
      ['tradeSession', { id: session.id }],
      ['brokerConnection', { accountId: acc.id }],
      ['brokerDailyClose', { accountId: acc.id }],
      ['brokerPayout', { accountId: acc.id }],
      ['accountIncident', { accountId: acc.id }],
    ] as const) {
      expect(await (prisma[model] as unknown as { count: (a: unknown) => Promise<number> }).count({ where }), model).toBe(0);
    }
    expect(await prisma.trade.count({ where: { userId: me.id, accountId: null } })).toBe(0);
    expect(await prisma.trade.count({ where: { accountId: keep.id } })).toBe(2);
    expect(await prisma.brokerConnection.count({ where: { accountId: keep.id } })).toBe(1);
    expect(await prisma.user.count({ where: { id: me.id } })).toBe(1);
  });

  it('compte non archivé (actif, échoué, validé) : 409, rien supprimé', async () => {
    const me = await register();
    for (const status of [AccountStatus.ACTIVE, AccountStatus.FAILED, AccountStatus.PASSED]) {
      const { acc } = await account(me.id, `Compte ${status}`, status, 100);
      const res = await deleteHttp(me.token, acc.id, { confirm: true });
      expect(res.status, status).toBe(409);
      expect(JSON.stringify(await res.json())).toContain('ACCOUNT_NOT_ARCHIVED');
      expect(await prisma.trade.count({ where: { accountId: acc.id } })).toBe(2);
      expect(await prisma.brokerConnection.count({ where: { accountId: acc.id } })).toBe(1);
    }
  });

  it('compte archivé d\'un autre utilisateur : 404, rien supprimé', async () => {
    const me = await register();
    const other = await register();
    const { acc } = await account(other.id, 'Test NT8', AccountStatus.ARCHIVED, -3000);
    expect((await deleteHttp(me.token, acc.id, { confirm: true })).status).toBe(404);
    expect(await prisma.trade.count({ where: { accountId: acc.id } })).toBe(2);
  });

  it('sans confirmation : 400, rien supprimé', async () => {
    const me = await register();
    const { acc } = await account(me.id, 'Test NT8', AccountStatus.ARCHIVED, -3000);
    for (const body of [undefined, {}, { confirm: 'true' }]) {
      expect((await deleteHttp(me.token, acc.id, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await prisma.trade.count({ where: { accountId: acc.id } })).toBe(2);
  });

  it('statistiques recalculées juste après (cache invalidé)', async () => {
    const me = await register();
    const { acc } = await account(me.id, 'Test NT8', AccountStatus.ARCHIVED, -3000);
    await account(me.id, 'Lucid Flex 50K', AccountStatus.ACTIVE, 500);
    // Vue « comptes inactifs compris » mise en cache avec l'archivé : 500 − 3000.
    expect((await analytics.getSummary(me.id, undefined, undefined, undefined, true)).totalPnl).toBe(-2500);

    expect((await deleteHttp(me.token, acc.id, { confirm: true })).status).toBe(200);

    expect((await analytics.getSummary(me.id, undefined, undefined, undefined, true)).totalPnl).toBe(500);
    expect((await analytics.getSummary(me.id)).totalPnl).toBe(500);
  });
});
