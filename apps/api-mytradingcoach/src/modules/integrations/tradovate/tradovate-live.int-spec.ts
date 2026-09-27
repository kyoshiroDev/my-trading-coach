/**
 * Temps réel Tradovate — séquence complète, sur la VRAIE app (createIntegrationApp : Resend neutralisé) :
 * app ouverte → rattrapage REST → événement WebSocket Tradovate → trade créé et relayé →
 * app fermée → WebSocket Tradovate fermé proprement.
 *
 * Tradovate est simulé des deux côtés : REST via `fetch`, WebSocket via LIVE_SOCKET_FACTORY.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { getStorageToken } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { randomBytes } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { createIntegrationApp } from '@api/test/integration-app.helper';
import { PrismaService } from '@api/prisma/prisma.service';
import { LIVE_SOCKET_FACTORY, TradovateLiveService } from './tradovate-live.service';
import type { LiveSocket } from './tradovate-live.connection';

const PREFIX = 'int-tvlive-';
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

process.env['TRADOVATE_OAUTH_CLIENT_ID'] = '16638';
process.env['TRADOVATE_OAUTH_CLIENT_SECRET'] = 'client-secret-de-test';
process.env['TRADOVATE_OAUTH_REDIRECT_URI'] = 'https://api.test/integrations/tradovate/callback';
process.env['BROKER_TOKEN_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
process.env['FRONTEND_URL'] = 'https://app.test';

// ── Tradovate REST simulé ────────────────────────────────────────────────────
const EXT_ACCOUNT = 777;
const CONTRACT = 4001;
const fill = (id: number, action: 'Buy' | 'Sell', price: number, timestamp: string) =>
  ({ id, orderId: id + 1, contractId: CONTRACT, timestamp, action, qty: 1, price, active: true });
const FILLS = [
  fill(1001, 'Buy', 30000, '2026-09-01T14:00:00.000Z'), fill(1002, 'Sell', 30010, '2026-09-01T14:05:00.000Z'),
  fill(2001, 'Buy', 30100, '2026-09-02T14:00:00.000Z'), fill(2002, 'Sell', 30120, '2026-09-02T14:05:00.000Z'),
  fill(3001, 'Buy', 30200, '2026-09-03T14:00:00.000Z'), fill(3002, 'Sell', 30205, '2026-09-03T14:05:00.000Z'),
];
const price = (fillId: number) => FILLS.find((f) => f.id === fillId)?.price ?? 0;
const pair = (id: number, buy: number, sell: number) =>
  ({ id, positionId: 9, buyFillId: buy, sellFillId: sell, qty: 1, buyPrice: price(buy), sellPrice: price(sell), active: true });
/** Paires visibles côté Tradovate : on en ajoute au fil du scénario (trades « faits »). */
const PAIRS = [pair(1, 1001, 1002)];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const byIds = <T extends { id: number }>(url: URL, items: T[]) => {
  const ids = new Set((url.searchParams.get('ids') ?? '').split(',').map(Number));
  return items.filter((i) => ids.has(i.id));
};

function tradovate(rawUrl: string, init?: RequestInit): Response {
  const url = new URL(rawUrl);
  if (url.pathname === '/auth/oauthtoken') {
    const form = new URLSearchParams(init?.body ? String(init.body) : '');
    if (form.get('grant_type') === 'authorization_code' && form.get('code') === 'good-code') {
      return json({ access_token: 'AT-1', expires_in: 4800, refresh_token: 'RT-1', refresh_token_expires_in: 2_592_000, token_type: 'bearer' });
    }
    return json({ error: 'invalid_grant' }, 401);
  }
  const env = url.hostname.startsWith('demo.') ? 'demo' : 'live';
  const path = url.pathname.replace('/v1', '');
  if (path === '/account/list') return json(env === 'demo' ? [{ id: EXT_ACCOUNT, name: 'APEX-LIVE-01', userId: 1, active: true }] : []);
  if (path === '/position/list') return json([{ id: 9, accountId: EXT_ACCOUNT, contractId: CONTRACT, netPos: 0 }]);
  if (path === '/fillPair/list') return json(PAIRS);
  // Fills et frais de la séance : lus par liste (cf. tradovate-sync.service, lots items ≤ 10).
  if (path === '/fill/list') return json(FILLS);
  if (path === '/fill/items') return json(byIds(url, FILLS));
  if (path === '/fillFee/list') return json(FILLS.map((f) => ({ id: f.id, commission: 0.35, exchangeFee: 0.1, clearingFee: 0.05, nfaFee: 0.02 })));
  if (path === '/fillFee/items') return json(byIds(url, FILLS).map((f) => ({ id: f.id, commission: 0.35, exchangeFee: 0.1, clearingFee: 0.05, nfaFee: 0.02 })));
  if (path === '/contract/items') return json([{ id: CONTRACT, name: 'MNQU6', contractMaturityId: 5001 }]);
  if (path === '/contractMaturity/items') return json([{ id: 5001, productId: 6001 }]);
  if (path === '/product/items') return json([{ id: 6001, name: 'MNQ', valuePerPoint: 2, tickSize: 0.25 }]);
  return json({ errorText: `route non simulée ${path}` }, 404);
}

// ── Tradovate WebSocket simulé ───────────────────────────────────────────────
class FakeTradovateSocket implements LiveSocket {
  readyState = 1;
  sent: string[] = [];
  closedWith: number | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {
    // Comme Tradovate : trame d'ouverture, puis réponse à l'autorisation.
    setTimeout(() => this.onmessage?.({ data: 'o' }), 5);
  }
  send(data: string) {
    this.sent.push(data);
    if (data.startsWith('authorize\n0\n')) {
      setTimeout(() => this.onmessage?.({ data: 'a[{"s":200,"i":0}]' }), 5);
    }
  }
  close(code = 1000) { this.closedWith = code; this.readyState = 3; this.onclose?.({ code }); }
  push(msg: object) { this.onmessage?.({ data: `a${JSON.stringify([msg])}` }); }
}
const wsSockets: FakeTradovateSocket[] = [];

// ── Stack ────────────────────────────────────────────────────────────────────
let app: INestApplication;
let prisma: PrismaService;
let baseUrl: string;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (/^https:\/\/(live|demo)\.tradovateapi\.com\//.test(url)) return Promise.resolve(tradovate(url, init));
    return realFetch(input, init);
  });
  ({ app, baseUrl } = await createIntegrationApp({
    configure: (b) =>
      b.overrideProvider(getStorageToken()).useValue({
        increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
      })
        .overrideProvider(LIVE_SOCKET_FACTORY)
        .useValue((url: string) => {
          const s = new FakeTradovateSocket(url);
          wsSockets.push(s);
          return s;
        }),
    setup: (a) => {
      a.use(cookieParser());
      a.setGlobalPrefix('api', {
        exclude: ['robots.txt', { path: 'integrations/tradovate/callback', method: RequestMethod.GET }],
      });
      a.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    },
  }));
  prisma = app.get(PrismaService);
}, 120_000);

afterAll(async () => {
  if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await app?.close().catch(() => undefined);
  vi.unstubAllGlobals();
});

async function registerUser(): Promise<{ id: string; token: string }> {
  const res = await realFetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${PREFIX}${uid()}@test.local`, password: 'int-test-no-login-1234', name: 'Int Live' }),
  });
  if (!res.ok) throw new Error(`register → ${res.status} : ${await res.text()}`);
  const body = (await res.json()) as { data: { access_token: string; user: { id: string } } };
  return { id: body.data.user.id, token: body.data.access_token };
}

/** Consentement + retour Tradovate (1re synchro comprise), comme tradovate-sync.int-spec. */
async function connectTradovate(token: string, accountId: string): Promise<void> {
  const res = await realFetch(`${baseUrl}/api/integrations/tradovate/accounts/${accountId}/authorize`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  const { data } = (await res.json()) as { data: { url: string } };
  const state = new URL(data.url).searchParams.get('state') as string;
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  const cb = await realFetch(`${baseUrl}/integrations/tradovate/callback?${new URLSearchParams({ code: 'good-code', state })}`, {
    redirect: 'manual', headers: { cookie },
  });
  expect(cb.headers.get('location')).toContain('tradovate=connected');
}

function openApp(token: string): Socket {
  return io(`${baseUrl}/tradovate-live`, { transports: ['websocket'], auth: { token }, reconnection: false, forceNew: true });
}

function next<T>(socket: Socket, event: string, ms = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`« ${event} » non reçu`)), ms);
    socket.once(event, (payload: T) => { clearTimeout(t); resolve(payload); });
  });
}

async function until(check: () => boolean | Promise<boolean>, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('condition jamais atteinte');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('Tradovate live — app ouverte, puis fermée', () => {
  it('rattrapage → trade poussé en direct → fermeture propre', async () => {
    const { id: userId, token } = await registerUser();
    const account = await prisma.tradingAccount.create({ data: { userId, label: 'Apex live' }, select: { id: true } });
    await connectTradovate(token, account.id);
    expect(await prisma.trade.count({ where: { userId } })).toBe(1);

    // App FERMÉE : un trade est fait chez Tradovate ; la dernière synchro remonte à 2 h.
    PAIRS.push(pair(2, 2001, 2002));
    await prisma.brokerConnection.update({
      where: { accountId_provider: { accountId: account.id, provider: 'TRADOVATE' } },
      data: { lastSyncAt: new Date(Date.now() - 2 * 3600_000) },
    });

    // 1. App ouverte → rattrapage REST immédiat, relayé au client.
    const client = openApp(token);
    const caughtUp = await next<{ accountId: string; created: number; source: string }>(client, 'tradovate:trades');
    expect(caughtUp).toMatchObject({ accountId: account.id, created: 1, source: 'catch-up' });
    expect(await prisma.trade.count({ where: { userId } })).toBe(2);

    // 2. WebSocket Tradovate ouvert pour CE compte : authorize + syncrequest + heartbeat.
    await until(() => wsSockets.some((s) => s.sent.some((m) => m.startsWith('user/syncrequest'))));
    const ws = wsSockets[wsSockets.length - 1];
    expect(ws.url).toBe('wss://demo.tradovateapi.com/v1/websocket');
    expect(ws.sent[0]).toBe('authorize\n0\n\nAT-1');
    expect(JSON.parse(ws.sent[1].split('\n')[3])).toEqual({ accounts: [EXT_ACCOUNT], entityTypes: ['fill', 'fillPair', 'position'] });

    // 3. Trade en direct : Tradovate pousse la nouvelle paire → trade créé via la synchro existante.
    PAIRS.push(pair(3, 3001, 3002));
    const liveEvent = next<{ created: number; source: string }>(client, 'tradovate:trades');
    ws.push({ e: 'props', d: { entityType: 'fillPair', eventType: 'Created', entity: { id: 3 } } });
    expect(await liveEvent).toMatchObject({ created: 1, source: 'live' });
    const live = await prisma.trade.findFirstOrThrow({ where: { userId, entry: 30200 } });
    // Même forme qu'un trade CSV / synchro manuelle (mapper réutilisé) : P&L, frais, empreinte.
    expect(live).toMatchObject({ accountId: account.id, asset: 'MNQ', side: 'LONG', exit: 30205, pnl: 10, commission: 1.04 });
    expect(live.importHash).toBe('MNQ|LONG|2026-09-03T14:05:00.000Z|30200|30205|10');

    // 4. App fermée → WebSocket Tradovate fermé (1000), plus rien ne tourne pour ce user.
    const liveService = app.get(TradovateLiveService);
    expect(liveService.openConnectionCount()).toBe(1);
    client.disconnect();
    await until(() => ws.closedWith === 1000);
    expect(liveService.openConnectionCount()).toBe(0);
    expect(await liveService.isLive(userId)).toBe(false);
  }, 30_000);

  it('jeton applicatif absent ou invalide → canal refusé, aucun WebSocket Tradovate', async () => {
    const before = wsSockets.length;
    const client = openApp('pas-un-jwt');
    await next(client, 'disconnect');
    expect(wsSockets.length).toBe(before);
  });
});
