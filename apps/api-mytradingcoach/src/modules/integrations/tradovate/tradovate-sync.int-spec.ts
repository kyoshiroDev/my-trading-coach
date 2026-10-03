/**
 * flux complet Tradovate : consentement → callback → synchro → dédup.
 *
 * Vraie stack (Postgres, Redis, HTTP, guards, filtre d'erreurs) ; seul Tradovate est simulé,
 * par un `fetch` intercepté qui laisse passer tout le reste. On prouve ici ce qu'un double ne
 * peut pas prouver : la contrainte d'unicité `importHash` en base, le rattachement au BON
 * TradingAccount, le chiffrement effectif des tokens, le renouvellement sans consentement, le
 * rapprochement avec un import CSV antérieur, et l'absence de tout appel d'écriture au broker.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrokerConnectionStatus } from '@prisma/client';
import { createIntegrationApp } from '@api/test/integration-app.helper';
import { PrismaService } from '@api/prisma/prisma.service';
import { TradovateTokenRefreshCron } from './tradovate-token-refresh.cron';

const PREFIX = 'int-tradovate-';
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const PERF_CSV = readFileSync(
  join(__dirname, '..', '..', 'trades', '__fixtures__', 'tradovate-performance.csv'),
);

process.env['TRADOVATE_OAUTH_CLIENT_ID'] = '16638';
process.env['TRADOVATE_OAUTH_CLIENT_SECRET'] = 'client-secret-de-test';
process.env['TRADOVATE_OAUTH_REDIRECT_URI'] = 'https://api.test/integrations/tradovate/callback';
process.env['BROKER_TOKEN_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
process.env['FRONTEND_URL'] = 'https://app.test';

// ── Tradovate simulé ─────────────────────────────────────────────────────────
const EXT_ACCOUNT = 777;
const CONTRACT = 4001;
const fill = (id: number, action: 'Buy' | 'Sell', price: number, timestamp: string) =>
  ({ id, orderId: id + 1, contractId: CONTRACT, timestamp, action, qty: 1, price, active: true });
const FILLS = [
  // Deux premières lignes de la fixture CSV (exportée à l'heure UTC)…
  fill(566569084424, 'Sell', 29915.0, '2026-07-10T15:33:34.412Z'),
  fill(566569084433, 'Buy', 29903.5, '2026-07-10T15:34:00.987Z'),
  fill(566569084427, 'Sell', 29915.75, '2026-07-10T15:33:34.500Z'),
  fill(566569084441, 'Buy', 29900.0, '2026-07-10T15:34:09.100Z'),
  // …plus un trade postérieur, absent du CSV (LONG 30000 → 30010, +20 $).
  fill(900000000001, 'Buy', 30000.0, '2026-07-11T14:00:00.000Z'),
  fill(900000000002, 'Sell', 30010.0, '2026-07-11T14:05:00.000Z'),
  // Fills d'un AUTRE compte du même login : ne doivent jamais être importés.
  fill(800000000001, 'Buy', 29000.0, '2026-07-11T15:00:00.000Z'),
  fill(800000000002, 'Sell', 29100.0, '2026-07-11T15:01:00.000Z'),
];
const PAIRS = [
  { id: 1, positionId: 9, buyFillId: 566569084433, sellFillId: 566569084424, qty: 1, buyPrice: 29903.5, sellPrice: 29915.0, active: true },
  { id: 2, positionId: 9, buyFillId: 566569084441, sellFillId: 566569084427, qty: 1, buyPrice: 29900.0, sellPrice: 29915.75, active: true },
  { id: 3, positionId: 9, buyFillId: 900000000001, sellFillId: 900000000002, qty: 1, buyPrice: 30000.0, sellPrice: 30010.0, active: true },
  { id: 4, positionId: 10, buyFillId: 800000000001, sellFillId: 800000000002, qty: 1, buyPrice: 29000.0, sellPrice: 29100.0, active: true },
];

type Call = { method: string; url: string; auth: string | null; body: string | null };
let calls: Call[] = [];
let refreshMode: 'ok' | 'refused' = 'ok';

// Comportements du vrai Tradovate reproduits à la demande (synchro de Val, 14/09/2026).
const ITEMS_LIMIT = 10;             // au-delà, Tradovate répond 404 (corps vide) à /fill/items et /fillFee/items
let extraPairs = 0;                 // paires supplémentaires sur le compte 777 (compte actif)
let listOmits = new Set<number>();  // fills absents de /fill/list et /fillFee/list
let itemsNotFound = false;          // /fill/items répond 404 quoi qu'on demande
let pairListNotFound = false;       // /fillPair/list répond 404

const EXTRA_BASE = 700000000000;
const at = (minute: number, second: number) => new Date(Date.UTC(2026, 6, 12, 14, minute, second)).toISOString();
const extraFills = () =>
  Array.from({ length: extraPairs }, (_, i) => [
    fill(EXTRA_BASE + 2 * i, 'Buy', 31000 + i, at(i, 0)),
    fill(EXTRA_BASE + 2 * i + 1, 'Sell', 31004 + i, at(i, 30)),
  ]).flat();
const extraPairsOf = () =>
  Array.from({ length: extraPairs }, (_, i) => ({
    id: 100 + i, positionId: 9, buyFillId: EXTRA_BASE + 2 * i, sellFillId: EXTRA_BASE + 2 * i + 1,
    qty: 1, buyPrice: 31000 + i, sellPrice: 31004 + i, active: true,
  }));
// Trade à N contrats découpé en N paires d'un contrat partageant le fill de vente : mêmes prix,
// même seconde de clôture → même empreinte (synchro de Val, 14/09/2026).
let identicalPairs = 0;
const SPLIT_SELL = 610000000000;
const splitFills = () =>
  identicalPairs
    ? [
        fill(SPLIT_SELL, 'Sell', 32010, '2026-07-13T15:00:00.000Z'),
        ...Array.from({ length: identicalPairs }, (_, i) =>
          fill(SPLIT_SELL + 1 + i, 'Buy', 32000, `2026-07-13T14:59:0${i}.000Z`)),
      ]
    : [];
const splitPairs = () =>
  Array.from({ length: identicalPairs }, (_, i) => ({
    id: 200 + i, positionId: 9, buyFillId: SPLIT_SELL + 1 + i, sellFillId: SPLIT_SELL,
    qty: 1, buyPrice: 32000, sellPrice: 32010, active: true,
  }));
const allFills = () => [...FILLS, ...extraFills(), ...splitFills()];
const allPairs = () => [...PAIRS, ...extraPairsOf(), ...splitPairs()];
const feeOf = (f: { id: number }) => ({ id: f.id, commission: 0.35, exchangeFee: 0.1, clearingFee: 0.05, nfaFee: 0.02 });
const notFound = () => new Response('', { status: 404 });
const tooMany = (url: URL) => (url.searchParams.get('ids') ?? '').split(',').filter(Boolean).length > ITEMS_LIMIT;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function byIds<T extends { id: number }>(url: URL, items: T[]): T[] {
  const ids = new Set((url.searchParams.get('ids') ?? '').split(',').map(Number));
  return items.filter((i) => ids.has(i.id));
}

function tradovate(rawUrl: string, init?: RequestInit): Response {
  const url = new URL(rawUrl);
  const headers = new Headers(init?.headers);
  const body = init?.body ? String(init.body) : null;
  calls.push({ method: init?.method ?? 'GET', url: rawUrl, auth: headers.get('authorization'), body });

  if (url.pathname === '/auth/oauthtoken') {
    const form = new URLSearchParams(body ?? '');
    if (form.get('grant_type') === 'authorization_code') {
      if (form.get('code') !== 'good-code') return json({ error: 'invalid_grant' }, 400);
      return json({ access_token: 'AT-1', expires_in: 4800, refresh_token: 'RT-1', refresh_token_expires_in: 2_592_000, id_token: 'x', token_type: 'bearer' });
    }
    if (form.get('grant_type') === 'refresh_token' && refreshMode === 'ok' && form.get('refresh_token') === 'RT-1') {
      return json({ access_token: 'AT-2', expires_in: 4800, refresh_token: 'RT-2', refresh_token_expires_in: 2_592_000 });
    }
    return json({ error: 'invalid_grant' }, 401);
  }

  const env = url.hostname.startsWith('demo.') ? 'demo' : 'live';
  const path = url.pathname.replace('/v1', '');
  if (path === '/auth/renewaccesstoken') return json({ errorText: 'Access is denied' });
  if (path === '/account/list') {
    // Compte de prop firm = simulé → n'existe que sur l'hôte demo.
    return json(env === 'demo' ? [{ id: EXT_ACCOUNT, name: 'APEX-1234-01', userId: 1, active: true }] : []);
  }
  if (path === '/position/list') {
    return json([
      { id: 9, accountId: EXT_ACCOUNT, contractId: CONTRACT, netPos: 0 },
      { id: 10, accountId: 999, contractId: CONTRACT, netPos: 0 },
      { id: 11, accountId: EXT_ACCOUNT, contractId: CONTRACT, netPos: 1 },
    ]);
  }
  if (path === '/fillPair/list') return pairListNotFound ? notFound() : json(allPairs());
  if (path === '/fill/list') return json(allFills().filter((f) => !listOmits.has(f.id)));
  if (path === '/fill/items') return itemsNotFound || tooMany(url) ? notFound() : json(byIds(url, allFills()));
  if (path === '/fillFee/list') return json(allFills().filter((f) => !listOmits.has(f.id)).map(feeOf));
  if (path === '/fillFee/items') return tooMany(url) ? notFound() : json(byIds(url, allFills()).map(feeOf));
  if (path === '/contract/items') return json([{ id: CONTRACT, name: 'MNQU6', contractMaturityId: 5001 }]);
  if (path === '/contractMaturity/items') return json([{ id: 5001, productId: 6001 }]);
  if (path === '/product/items') return json([{ id: 6001, name: 'MNQ', valuePerPoint: 2, tickSize: 0.25 }]);
  if (path === '/cashBalance/getcashbalancesnapshot') {
    // Lecture exposée en POST par Tradovate : le compte vient du corps.
    const accountId = body ? (JSON.parse(body) as { accountId?: number }).accountId : undefined;
    if (accountId !== EXT_ACCOUNT) return json({ errorText: 'account not found' }, 404);
    return json({ totalCashValue: 50_123.5, netLiq: 50_098.5, openPnL: -25, realizedPnL: 40 });
  }
  return json({ errorText: `route non simulée ${path}` }, 404);
}

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
  // Rate limiting neutralisé par createIntegrationApp (toutes les requêtes viennent de la même IP).
  ({ app, baseUrl } = await createIntegrationApp({
    setup: (a) => {
      a.use(cookieParser());
      // Même préfixe que main.ts, callback exclu (redirect_uri enregistré sans /api).
      a.setGlobalPrefix('api', {
        exclude: ['robots.txt', { path: 'integrations/tradovate/callback', method: RequestMethod.GET }],
      });
      // Même validation que main.ts (sans elle, un DTO invalide passerait en test seulement).
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

beforeEach(async () => {
  // Chaque test crée son propre user MTC, mais tous se relient au même compte simulé EXT_ACCOUNT.
  // Un compte broker ne se relie qu'à un seul user (dropAlreadyLinked) : sans ce nettoyage, le
  // premier test garde le compte et tous les suivants reçoivent `account_already_linked`.
  await prisma.brokerConnection.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  calls = [];
  refreshMode = 'ok';
  extraPairs = 0;
  listOmits = new Set();
  itemsNotFound = false;
  pairListNotFound = false;
  identicalPairs = 0;
});

/**
 * Libère le compte simulé EXT_ACCOUNT pour qu'un AUTRE user puisse s'y relier dans le même test
 * (un compte broker ne se relie qu'à un seul user). Réservé aux tests qui ne portent pas sur ce partage.
 */
const releaseExtAccount = (accountId: string) =>
  prisma.brokerConnection.updateMany({ where: { accountId }, data: { externalAccountId: `libere-${accountId}` } });

async function registerUser(): Promise<{ id: string; token: string }> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${PREFIX}${uid()}@test.local`, password: 'int-test-no-login-1234', name: 'Int Tradovate' }),
  });
  if (!res.ok) throw new Error(`register → ${res.status} : ${await res.text()}`);
  const body = (await res.json()) as { data: { access_token: string; user: { id: string } } };
  return { id: body.data.user.id, token: body.data.access_token };
}

const api = (token: string, path: string, method = 'GET', extra: RequestInit = {}) =>
  fetch(`${baseUrl}/api/integrations/tradovate${path}`, {
    method,
    ...extra,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(extra.headers ?? {}) },
  });

/** Démarre le consentement puis simule le retour Tradovate. Renvoie la redirection vers l'app. */
async function connect(
  token: string,
  accountId: string,
  opts: { sendCookie?: boolean; code?: string; state?: string; origin?: 'wizard' | 'settings' } = {},
) {
  const res = await api(token, `/accounts/${accountId}/authorize`, 'POST', {
    body: opts.origin ? JSON.stringify({ origin: opts.origin }) : undefined,
  });
  expect(res.status, await res.clone().text()).toBeLessThan(300);
  const { data } = (await res.json()) as { data: { url: string } };
  const authorize = new URL(data.url);
  const state = authorize.searchParams.get('state') as string;
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];

  const q = new URLSearchParams({ code: opts.code ?? 'good-code', state: opts.state ?? state });
  const cb = await fetch(`${baseUrl}/integrations/tradovate/callback?${q}`, {
    redirect: 'manual',
    headers: opts.sendCookie === false ? {} : { cookie },
  });
  return { authorize, cookie, callback: cb, location: new URL(cb.headers.get('location') ?? 'https://none') };
}

async function createAccount(userId: string, label: string) {
  return prisma.tradingAccount.create({ data: { userId, label }, select: { id: true } });
}

describe('Tradovate — consentement', () => {
  it('URL de consentement Live, redirect_uri enregistré, state doublé d’un cookie httpOnly', async () => {
    const { id: userId, token } = await registerUser();
    const account = await createAccount(userId, 'Apex 50k');
    const { authorize, cookie, callback, location } = await connect(token, account.id);

    expect(authorize.origin + authorize.pathname).toBe('https://trader.tradovate.com/oauth');
    expect(authorize.searchParams.get('client_id')).toBe('16638');
    expect(authorize.searchParams.get('redirect_uri')).toBe('https://api.test/integrations/tradovate/callback');
    expect(cookie).toMatch(/^mtc_tradovate_oauth=/);

    // Callback servi HORS /api, puis 302 vers les réglages de l'app.
    expect(callback.status).toBe(302);
    expect(location.origin + location.pathname).toBe('https://app.test/accounts');
    expect(location.searchParams.get('tradovate')).toBe('connected');
    expect(location.searchParams.get('accountId')).toBe(account.id);
    // Première synchro faite au retour : l'utilisateur revient avec ses trades.
    expect(location.searchParams.get('trades')).toBe('3');
    expect(location.searchParams.get('fees')).toBe('ok');
    expect(location.searchParams.get('from')).toBeNull();
    expect(await prisma.trade.count({ where: { userId } })).toBe(3);

    // Le client_secret n'a voyagé que serveur → Tradovate, jamais dans l'URL navigateur.
    expect(authorize.toString()).not.toContain('client-secret-de-test');
    expect(calls.find((c) => c.url.endsWith('/auth/oauthtoken'))?.body).toContain('client_secret=client-secret-de-test');

    const conn = await prisma.brokerConnection.findFirstOrThrow({ where: { accountId: account.id } });
    expect(conn.userId).toBe(userId);
    // Tokens chiffrés en base, jamais en clair.
    expect(conn.accessTokenEnc).not.toContain('AT-1');
    expect(conn.refreshTokenEnc).not.toContain('RT-1');
    expect(conn.accessTokenEnc.startsWith('v1:')).toBe(true);
    // Un seul compte (simulé, hôte demo) → choisi automatiquement.
    expect(conn).toMatchObject({ externalAccountId: String(EXT_ACCOUNT), externalEnv: 'demo', status: 'CONNECTED' });
  });

  it('parti du wizard : retour sur /dashboard (overlay d’onboarding) avec from=wizard', async () => {
    const { id: userId, token } = await registerUser();
    const account = await createAccount(userId, 'Apex');
    const { location } = await connect(token, account.id, { origin: 'wizard' });
    expect(location.pathname).toBe('/dashboard');
    expect(location.searchParams.get('from')).toBe('wizard');
    expect(location.searchParams.get('tradovate')).toBe('connected');
    expect(location.searchParams.get('trades')).toBe('3');
  });

  it('origine invalide refusée par la validation', async () => {
    const { id: userId, token } = await registerUser();
    const account = await createAccount(userId, 'Compte');
    const res = await api(token, `/accounts/${account.id}/authorize`, 'POST', {
      body: JSON.stringify({ origin: 'ailleurs' }),
    });
    expect(res.status).toBe(400);
  });

  it('sans le cookie de state : refus (un tiers ne peut pas faire atterrir SON Tradovate chez une victime)', async () => {
    const { id: userId, token } = await registerUser();
    const account = await createAccount(userId, 'Compte');
    const { location } = await connect(token, account.id, { sendCookie: false });
    expect(location.searchParams.get('tradovate')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('session_expired');
    expect(await prisma.brokerConnection.count({ where: { accountId: account.id } })).toBe(0);
  });

  it('state renvoyé différent du cookie → refus', async () => {
    const { id: userId, token } = await registerUser();
    const account = await createAccount(userId, 'Compte');
    const { location } = await connect(token, account.id, { state: 'autre.state' });
    expect(location.searchParams.get('reason')).toBe('state_mismatch');
    expect(await prisma.brokerConnection.count({ where: { accountId: account.id } })).toBe(0);
  });

  it('code refusé par Tradovate → retour app avec erreur lisible, aucune connexion', async () => {
    const { id: userId, token } = await registerUser();
    const account = await createAccount(userId, 'Compte');
    const { location } = await connect(token, account.id, { code: 'mauvais-code' });
    expect(location.searchParams.get('reason')).toBe('exchange_failed');
    expect(await prisma.brokerConnection.count({ where: { accountId: account.id } })).toBe(0);
  });

  it('impossible de lancer la connexion sur le compte d’un autre user', async () => {
    const owner = await registerUser();
    const intruder = await registerUser();
    const account = await createAccount(owner.id, 'Pas à toi');
    const res = await api(intruder.token, `/accounts/${account.id}/authorize`, 'POST');
    expect(res.status).toBe(404);
  });
});

describe('Tradovate — synchro', () => {
  it('importe les trades du BON compte, dédoublonne le CSV antérieur, puis la synchro suivante', async () => {
    const { id: userId, token } = await registerUser();
    const account = await createAccount(userId, 'Apex 50k');

    // 1. Import CSV antérieur de l'export Performance (20 trades).
    const form = new FormData();
    form.append('file', new Blob([PERF_CSV], { type: 'text/csv' }), 'Performance.csv');
    form.append('accountId', account.id);
    const csv = await fetch(`${baseUrl}/api/trades/import`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form,
    });
    expect(csv.ok, await csv.clone().text()).toBe(true);
    expect(await prisma.trade.count({ where: { userId } })).toBe(20);

    // 2. Connexion : la première synchro part au retour. 3 paires du compte 777 : 2 déjà
    // importées par CSV (décalage de fuseau toléré), 1 nouvelle. Le compte 999 n'est pas touché.
    const { location } = await connect(token, account.id);
    expect(location.searchParams.get('trades')).toBe('1');
    expect(await prisma.trade.count({ where: { userId } })).toBe(21);

    // Synchro manuelle : rapport complet, tout est déjà là.
    calls = [];
    const first = await api(token, `/accounts/${account.id}/sync`, 'POST');
    expect(first.status, await first.clone().text()).toBe(201);
    const r1 = ((await first.json()) as { data: Record<string, unknown> }).data;
    expect(r1).toMatchObject({ created: 0, duplicates: 3, failed: 0, total: 3, skipped: 0, openPositions: 1 });
    expect(r1['feesImported']).toMatchObject({ reconciled: true, assigned: 3.12, expected: 3.12 });

    // Même forme qu'un trade CSV : compte cible, « Sans setup », empreinte, frais, P&L brut.
    const synced = await prisma.trade.findFirstOrThrow({
      where: { userId, tradedAt: new Date('2026-07-11T14:05:00Z') },
      include: { setup: true },
    });
    expect(synced.setup.title).toBe('Sans setup');
    expect(synced).toMatchObject({
      accountId: account.id, asset: 'MNQ', side: 'LONG', entry: 30000, exit: 30010,
      pnl: 20, commission: 1.04, quantity: 1, emotion: null,
    });
    expect(synced.importHash).toBe('MNQ|LONG|2026-07-11T14:05:00.000Z|30000|30010|20');
    expect(synced.setupId).toBeTruthy();
    expect(await prisma.trade.count({ where: { userId, entry: 29000 } })).toBe(0);

    // Lecture seule : que des GET vers l'API de données, sur l'hôte du compte (demo), plus la SEULE
    // lecture que Tradovate expose en POST (instantané de solde). Les appels d'auth sont à part :
    // `renewaccesstoken` (sur live) relit `apiHosts` à chaque synchro.
    const dataCalls = calls.filter((c) => !new URL(c.url).pathname.includes('/auth/'));
    expect(dataCalls.filter((c) => c.method !== 'GET').map((c) => new URL(c.url).pathname))
      .toEqual(expect.arrayContaining(['/v1/cashBalance/getcashbalancesnapshot']));
    expect(dataCalls.every((c) => c.method === 'GET' || c.url.endsWith('/cashBalance/getcashbalancesnapshot'))).toBe(true);
    expect(dataCalls.every((c) => c.url.startsWith('https://demo.tradovateapi.com/v1/'))).toBe(true);
    expect(dataCalls.every((c) => c.auth === 'Bearer AT-1')).toBe(true);
    // Solde et equity relus chez le broker en fin de synchro ; une position ouverte sur le compte.
    expect(await prisma.brokerConnection.findFirst({ where: { userId }, select: {
      brokerCashBalance: true, brokerNetLiq: true, brokerOpenPnl: true, brokerOpenPositions: true,
    } })).toEqual({ brokerCashBalance: 50_123.5, brokerNetLiq: 50_098.5, brokerOpenPnl: -25, brokerOpenPositions: 1 });

    expect(await prisma.trade.count({ where: { userId } })).toBe(21);

    // 4. État exposé au front : jamais de token.
    const list = await api(token, '/connections');
    const text = await list.text();
    expect(text).not.toMatch(/accessTokenEnc|refreshTokenEnc|AT-1|RT-1/);
    const [view] = (JSON.parse(text) as { data: Record<string, unknown>[] }).data;
    expect(view).toMatchObject({ accountId: account.id, status: 'CONNECTED', tradesImported: 1, needsAccountSelection: false });
    expect(view['lastSyncAt']).toBeTruthy();
  });

  it('première synchro : tout l’historique, y compris les fills ANTÉRIEURS à la connexion (aucune borne de date)', async () => {
    const { id: userId, token } = await registerUser();
    const account = await createAccount(userId, 'Apex tout juste connecté');
    const connectedAt = new Date();

    calls = [];
    const { location } = await connect(token, account.id);

    // Fills du 10-11/07/2026, bien avant la connexion : tous importés dès le premier passage.
    expect(location.searchParams.get('trades')).toBe('3');
    const trades = await prisma.trade.findMany({ where: { userId }, select: { tradedAt: true } });
    expect(trades).toHaveLength(3);
    expect(trades.every((t) => t.tradedAt < connectedAt)).toBe(true);

    // Les routes list partent SANS aucun filtre : ni date de connexion, ni lastSyncAt.
    const lists = calls.filter((c) => /\/(position|fillPair|fill|fillFee)\/list/.test(c.url));
    expect(lists.map((c) => new URL(c.url).pathname)).toEqual([
      '/v1/position/list', '/v1/fillPair/list', '/v1/fill/list', '/v1/fillFee/list',
    ]);
    expect(lists.every((c) => new URL(c.url).search === '')).toBe(true);
  });

  it('token expiré → renouvelé par refresh_token, sans nouveau consentement', async () => {
    const { id: userId, token } = await registerUser();
    const account = await createAccount(userId, 'Compte');
    await connect(token, account.id);
    await prisma.brokerConnection.updateMany({
      where: { accountId: account.id },
      data: { accessTokenExpiresAt: new Date(Date.now() - 60_000) },
    });
    calls = [];

    const res = await api(token, `/accounts/${account.id}/sync`, 'POST');
    expect(res.status, await res.clone().text()).toBe(201);
    const refresh = calls.find((c) => c.url.endsWith('/auth/oauthtoken'));
    expect(refresh?.body).toContain('grant_type=refresh_token');
    expect(calls.filter((c) => c.auth).every((c) => c.auth === 'Bearer AT-2')).toBe(true);

    const conn = await prisma.brokerConnection.findFirstOrThrow({ where: { accountId: account.id } });
    expect(conn.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  // Objectif produit (2026-09-26) : connecté tant que l'utilisateur ne clique pas sur Déconnecter.
  // Un refus alors que Tradovate annonce le refresh_token valide est passager : on garde la connexion.
  it('refresh refusé, refresh_token encore annoncé valide → 503 TRADOVATE_REFRESH_DEFERRED, connexion gardée', async () => {
    const { id: userId, token } = await registerUser();
    const account = await createAccount(userId, 'Compte');
    await connect(token, account.id);
    await prisma.brokerConnection.updateMany({
      where: { accountId: account.id },
      data: {
        accessTokenExpiresAt: new Date(Date.now() - 60_000),
        refreshTokenExpiresAt: new Date(Date.now() + 10 * 3600_000),
      },
    });
    refreshMode = 'refused';

    const res = await api(token, `/accounts/${account.id}/sync`, 'POST');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('TRADOVATE_REFRESH_DEFERRED');

    const conn = await prisma.brokerConnection.findFirstOrThrow({ where: { accountId: account.id } });
    expect(conn.status).toBe(BrokerConnectionStatus.CONNECTED);
    expect(conn.lastSyncError).toMatch(/réessaie automatiquement/);
  });

  it('refresh refusé et refresh_token échu → 409 TRADOVATE_RECONNECT_REQUIRED, connexion à reconnecter', async () => {
    const { id: userId, token } = await registerUser();
    const account = await createAccount(userId, 'Compte');
    await connect(token, account.id);
    await prisma.brokerConnection.updateMany({
      where: { accountId: account.id },
      data: {
        accessTokenExpiresAt: new Date(Date.now() - 60_000),
        // Seul cas de condamnation : Tradovate ne promet plus rien.
        refreshTokenExpiresAt: new Date(Date.now() - 60_000),
      },
    });
    refreshMode = 'refused';

    const res = await api(token, `/accounts/${account.id}/sync`, 'POST');
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('TRADOVATE_RECONNECT_REQUIRED');
    expect(body.message).toMatch(/Reconnecte ton compte/);
    expect(JSON.stringify(body)).not.toMatch(/stack|at .*\.ts/);

    const conn = await prisma.brokerConnection.findFirstOrThrow({ where: { accountId: account.id } });
    expect(conn.status).toBe(BrokerConnectionStatus.NEEDS_RECONNECT);
  });

  it('compte actif (> 10 fills) : fills et frais lus par liste, jamais de lot /items au-delà de 10', async () => {
    // Synchro de Val (14/09/2026) : 28 paires, 41 fills demandés d'un coup à /fill/items →
    // 404 de Tradovate, synchro entièrement en échec affichée « compte plus accessible ».
    extraPairs = 12;
    const { id: userId, token } = await registerUser();
    const account = await createAccount(userId, 'Compte actif');
    calls = [];
    const { location } = await connect(token, account.id);

    expect(location.searchParams.get('tradovate')).toBe('connected');
    expect(location.searchParams.get('trades')).toBe('15');
    expect(location.searchParams.get('fees')).toBe('ok');
    expect(await prisma.trade.count({ where: { userId } })).toBe(15);

    const batches = calls.filter((c) => /\/(fill|fillFee)\/items/.test(c.url));
    expect(batches.every((c) => (new URL(c.url).searchParams.get('ids') ?? '').split(',').length <= ITEMS_LIMIT)).toBe(true);
    expect(calls.some((c) => new URL(c.url).pathname === '/v1/fill/list')).toBe(true);
  });

  it('fill absent de la liste : relu par petit lot ; introuvable, seule sa paire est ignorée', async () => {
    // Relu par /fill/items (1 id) : les 3 trades sont importés.
    listOmits = new Set([900000000002]);
    const a = await registerUser();
    const accountA = await createAccount(a.id, 'Compte A');
    calls = [];
    const first = await connect(a.token, accountA.id);
    expect(first.location.searchParams.get('trades')).toBe('3');
    const reread = calls.find((c) => new URL(c.url).pathname === '/v1/fill/items');
    expect(new URL(reread?.url ?? 'https://none').searchParams.get('ids')).toBe('900000000002');

    // Introuvable même par /fill/items : la synchro aboutit, la paire concernée est ignorée.
    itemsNotFound = true;
    await releaseExtAccount(accountA.id);
    const b = await registerUser();
    const accountB = await createAccount(b.id, 'Compte B');
    const second = await connect(b.token, accountB.id);
    expect(second.location.searchParams.get('tradovate')).toBe('connected');
    expect(second.location.searchParams.get('trades')).toBe('2');
    const conn = await prisma.brokerConnection.findFirstOrThrow({ where: { accountId: accountB.id } });
    expect(conn).toMatchObject({ status: BrokerConnectionStatus.CONNECTED, lastSyncError: null });
  });

  it('CSV Performance importé APRÈS la synchro : les trades déjà synchronisés ne sont pas recréés', async () => {
    // Sens inverse du premier test : la synchro crée les 3 trades, puis l'utilisateur importe
    // son export Performance (heures locales sans fuseau). Les 2 trades communs = doublons.
    const { id: userId, token } = await registerUser();
    const account = await createAccount(userId, 'Synchro puis CSV');
    const { location } = await connect(token, account.id);
    expect(location.searchParams.get('trades')).toBe('3');

    const form = new FormData();
    form.append('file', new Blob([PERF_CSV], { type: 'text/csv' }), 'Performance.csv');
    form.append('accountId', account.id);
    const csv = await fetch(`${baseUrl}/api/trades/import`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form,
    });
    expect(csv.ok, await csv.clone().text()).toBe(true);
    const { data } = (await csv.json()) as { data: { created: number; duplicates: number } };
    expect(data).toMatchObject({ created: 18, duplicates: 2 });
    expect(await prisma.trade.count({ where: { userId } })).toBe(21);
  });

  it('trade à plusieurs contrats (paires identiques) : chaque paire devient un trade, resynchro sans doublon', async () => {
    // Synchro de Val (14/09/2026) : 4 paires d'un contrat, même fill de vente, mêmes prix →
    // même empreinte ; 3 étaient écartées comme « doublons » (contrats et P&L perdus).
    identicalPairs = 4;
    const { id: userId, token } = await registerUser();
    const account = await createAccount(userId, 'Compte multi-contrats');
    const { location } = await connect(token, account.id);

    expect(location.searchParams.get('trades')).toBe('7'); // 3 de base + 4 paires identiques
    const split = await prisma.trade.findMany({ where: { userId, entry: 32000 }, select: { importHash: true } });
    expect(split).toHaveLength(4);
    expect(new Set(split.map((t) => t.importHash)).size, 'une empreinte distincte par répétition').toBe(4);

    const again = await api(token, `/accounts/${account.id}/sync`, 'POST');
    expect(again.status, await again.clone().text()).toBe(201);
    const r = ((await again.json()) as { data: { created: number; duplicates: number } }).data;
    expect(r).toMatchObject({ created: 0, duplicates: 7 });
    expect(await prisma.trade.count({ where: { userId } })).toBe(7);
  });

  it('404 de Tradovate sur une lecture de données → « momentanément injoignable », connexion intacte', async () => {
    const { id: userId, token } = await registerUser();
    const account = await createAccount(userId, 'Compte');
    await connect(token, account.id);
    pairListNotFound = true;

    const res = await api(token, `/accounts/${account.id}/sync`, 'POST');
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('TRADOVATE_UNAVAILABLE');
    expect(body.message, 'Une reconnexion ne réglerait rien : ne pas y renvoyer').not.toMatch(/Reconnecte/);

    const conn = await prisma.brokerConnection.findFirstOrThrow({ where: { accountId: account.id } });
    expect(conn.status).toBe(BrokerConnectionStatus.CONNECTED);
    expect(conn.lastSyncError ?? '').not.toMatch(/Reconnecte/);
  });

  it('compte démo : lecture de l’état autorisée, synchro et connexion bloquées', async () => {
    const { id: userId, token } = await registerUser();
    const account = await createAccount(userId, 'Compte');
    await connect(token, account.id);
    await prisma.user.update({ where: { id: userId }, data: { isDemo: true } });

    expect((await api(token, '/connections')).status).toBe(200);
    expect((await api(token, `/accounts/${account.id}/sync`, 'POST')).status).toBe(403);
    expect((await api(token, `/accounts/${account.id}/authorize`, 'POST')).status).toBe(403);
  });

  it('déconnexion : tokens supprimés, trades conservés, synchro ensuite refusée', async () => {
    const { id: userId, token } = await registerUser();
    const account = await createAccount(userId, 'Compte');
    await connect(token, account.id);
    await api(token, `/accounts/${account.id}/sync`, 'POST');
    const trades = await prisma.trade.count({ where: { userId } });
    expect(trades).toBe(3); // première synchro au retour + synchro manuelle sans doublon

    expect((await api(token, `/accounts/${account.id}`, 'DELETE')).status).toBe(200);
    expect(await prisma.brokerConnection.count({ where: { accountId: account.id } })).toBe(0);
    expect(await prisma.trade.count({ where: { userId } })).toBe(trades);

    const res = await api(token, `/accounts/${account.id}/sync`, 'POST');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('TRADOVATE_NOT_CONNECTED');
  });

  it('deux comptes MTC, deux connexions indépendantes (Apex + Lucid)', async () => {
    const { id: userId, token } = await registerUser();
    const apex = await createAccount(userId, 'Apex');
    const lucid = await createAccount(userId, 'Lucid');
    await connect(token, apex.id);
    await connect(token, lucid.id);
    const rows = await prisma.brokerConnection.findMany({ where: { userId } });
    expect(rows.map((r) => r.accountId).sort()).toEqual([apex.id, lucid.id].sort());
    expect(rows[0].accessTokenEnc).not.toBe(rows[1].accessTokenEnc);
  });
});

describe('Tradovate — cron de maintien des tokens (vraie base)', () => {
  it('renouvelle seulement les connexions proches de l’échéance, hors comptes démo', async () => {
    const soon = await registerUser();
    const later = await registerUser();
    const demo = await registerUser();
    const [aSoon, aLater, aDemo] = await Promise.all([
      createAccount(soon.id, 'Bientôt'), createAccount(later.id, 'Plus tard'), createAccount(demo.id, 'Démo'),
    ]);
    // Le cron ne regarde que l'échéance des jetons : chaque user libère le compte simulé pour le suivant.
    await connect(soon.token, aSoon.id);
    await releaseExtAccount(aSoon.id);
    await connect(later.token, aLater.id);
    await releaseExtAccount(aLater.id);
    await connect(demo.token, aDemo.id);
    await prisma.user.update({ where: { id: demo.id }, data: { isDemo: true } });
    const in2h = new Date(Date.now() + 2 * 3600_000);
    await prisma.brokerConnection.updateMany({ where: { accountId: { in: [aSoon.id, aDemo.id] } }, data: { refreshTokenExpiresAt: in2h } });
    await prisma.brokerConnection.updateMany({ where: { accountId: aLater.id }, data: { refreshTokenExpiresAt: new Date(Date.now() + 24 * 3600_000) } });
    const before = await prisma.brokerConnection.findMany({ where: { accountId: { in: [aSoon.id, aLater.id, aDemo.id] } } });
    calls = [];

    const r = await app.get(TradovateTokenRefreshCron).refreshExpiring();

    // D'autres connexions de la base peuvent être dues : on vérifie les nôtres.
    expect(r.refreshed).toBeGreaterThanOrEqual(1);
    const refreshCalls = calls.filter((c) => c.body?.includes('grant_type=refresh_token'));
    expect(refreshCalls.length).toBeGreaterThanOrEqual(1);
    expect(calls.every((c) => c.url.endsWith('/auth/oauthtoken')), 'aucune lecture de trades').toBe(true);

    const after = await prisma.brokerConnection.findMany({ where: { accountId: { in: [aSoon.id, aLater.id, aDemo.id] } } });
    const changed = (id: string) =>
      after.find((c) => c.accountId === id)!.accessTokenEnc !== before.find((c) => c.accountId === id)!.accessTokenEnc;
    expect(changed(aSoon.id), 'proche de l’échéance → renouvelée').toBe(true);
    expect(changed(aLater.id), 'encore 24 h → laissée tranquille').toBe(false);
    expect(changed(aDemo.id), 'compte démo → jamais ciblé').toBe(false);
    const renewed = after.find((c) => c.accountId === aSoon.id)!;
    expect(renewed.refreshTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 20 * 24 * 3600_000);
    expect(renewed.status).toBe('CONNECTED');
  });
});
