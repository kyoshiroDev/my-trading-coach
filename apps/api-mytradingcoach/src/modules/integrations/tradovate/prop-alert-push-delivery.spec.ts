import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PropAlertsService } from './prop-alerts.service';
import { MAX_UNDELIVERED_PUSH } from './prop-alert-push';
import { ALERT_LEVEL_RANK as RANK } from './prop-alert-levels';
import { TraderNotifier } from '../../push/trader-notifier.service';
import { TraderPushService } from '../../push/trader-push.service';
import type { PushSender, PushTarget } from '../../push/push-sender';

/**
 * Marqueur « push envoyé » posé SEULEMENT si un appareil a reçu le push (correctif #719, I3).
 * Vraie chaîne alerte → TraderNotifier → TraderPushService → deliverPush ; seul le service push du
 * navigateur est simulé (code HTTP par appareil). Limite franchie : forcée, hors anti-spam.
 */

type Reply = number | Error;
const fcm = (id: string) => `https://fcm.googleapis.com/fcm/send/${id}`;
const NOW = new Date(Date.UTC(2026, 5, 2, 16));
const PUSH_KEY = 'prop-alert-push:a:drawdown:2026-06-02';

type Pref = { mutedTypes: string[]; quietStart: number | null; quietEnd: number | null } | null;

function setup(devices: { id: string; endpoint: string; reply: Reply }[], pushPreference: Pref = null) {
  const store = new Map<string, string>();
  const redis = {
    client: {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => { store.set(k, v); return 'OK'; }),
      del: vi.fn(async (...keys: string[]) => { keys.forEach((k) => store.delete(k)); return keys.length; }),
      incr: vi.fn(async (k: string) => { const n = Number(store.get(k) ?? 0) + 1; store.set(k, String(n)); return n; }),
      expire: vi.fn(async () => 1),
      // Scripts Lua de `prop-alert-push.ts`, rejoués en JS (exécutés pour de vrai dans l'int-spec).
      eval: vi.fn(async (lua: string, _n: number, key: string, level: string, a: string) => {
        const cur = store.get(key) ?? null;
        if (lua.includes('local rank')) {
          if (cur && RANK[cur as keyof typeof RANK] >= RANK[level as keyof typeof RANK]) return null;
          store.set(key, level);
          return cur ?? '';
        }
        if (cur !== level) return 0;
        if (a === '') store.delete(key); else store.set(key, a);
        return 1;
      }),
    },
  };
  let rows = devices.map((d) => ({ id: d.id, endpoint: d.endpoint, p256dh: 'k'.repeat(87), auth: 'a'.repeat(22) }));
  const prisma = {
    user: {
      findUnique: vi.fn(async () => ({
        plan: 'PREMIUM', role: 'USER', trialEndsAt: null, isDemo: false, pushPreference, _count: { pushDevices: rows.length },
      })),
    },
    tradingAccount: { findMany: vi.fn(async () => [{ id: 'a', propFirmPlan: null }]) },
    userPushDevice: {
      findMany: vi.fn(async () => rows),
      update: vi.fn(async () => ({})),
      deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
        rows = rows.filter((r) => r.id !== where.id);
        return { count: 1 };
      }),
    },
  };
  const send = vi.fn(async (t: PushTarget) => {
    const reply = devices.find((d) => d.endpoint === t.endpoint)!.reply;
    if (reply instanceof Error) throw reply;
    return reply;
  });
  const config = { enabled: true as const, config: { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:support@mytradingcoach.app' } };
  const push = new TraderPushService(prisma as never, config, { send } as PushSender);
  const notifier = new TraderNotifier(prisma as never, redis as never, push);
  const metrics = { drawdown: { pct: 0, breached: true, margin: 0, maxDrawdown: 2000 }, dailyLoss: null };
  const accounts = { list: vi.fn(async () => [{ id: 'a', label: 'Apex 50k', currency: 'USD', status: 'ACTIVE', metrics }]) };
  const quiet = { recordReading: vi.fn(async () => undefined), recordEvent: vi.fn(async () => undefined), detectQuietly: vi.fn(async () => undefined) };
  const svc = new PropAlertsService(prisma as never, redis as never, accounts as never, quiet as never, quiet as never, notifier);
  const sync = () => svc.checkFromBackground('u', 'a', NOW);
  return { sync, store, send, redis };
}

describe('Push prop firm : marqueur posé seulement si un appareil l’a reçu', () => {
  it.each([
    ['tous les appareils en 5xx', [503, 500]],
    ['délai total dépassé', [new Error('délai total de 10000 ms dépassé')]],
    ['abonnement mort (410)', [410]],
  ] as [string, Reply[]][])('%s : aucun marqueur, retenté au relevé suivant', async (_, replies) => {
    const { sync, store, send } = setup(replies.map((reply, i) => ({ id: `d${i}`, endpoint: fcm(`d${i}`), reply })));
    await sync();
    expect(store.has(PUSH_KEY)).toBe(false);
    const calls = send.mock.calls.length;
    expect(calls).toBe(replies.length);
    await sync();
    // 410 : l'abonnement est supprimé, plus rien à contacter ; sinon nouvel essai.
    expect(send.mock.calls.length).toBe(replies[0] === 410 ? calls : calls * 2);
    expect(store.has(PUSH_KEY)).toBe(false);
  });

  it('adresse hors liste blanche : jamais contactée, aucun marqueur', async () => {
    const { sync, store, send } = setup([{ id: 'd0', endpoint: 'https://169.254.169.254/latest', reply: 201 }]);
    await sync();
    expect(send).not.toHaveBeenCalled();
    expect(store.has(PUSH_KEY)).toBe(false);
  });

  it('plusieurs appareils, un seul reçoit : marqueur posé, pas de second envoi', async () => {
    const { sync, store, send } = setup([
      { id: 'd0', endpoint: fcm('d0'), reply: 503 },
      { id: 'd1', endpoint: fcm('d1'), reply: 201 },
      { id: 'd2', endpoint: fcm('d2'), reply: new Error('délai total de 10000 ms dépassé') },
    ]);
    await sync();
    expect(store.get(PUSH_KEY)).toBe('breached');
    await sync();
    expect(send).toHaveBeenCalledTimes(3);
  });

  it(`retentes bornées : abandon après ${MAX_UNDELIVERED_PUSH} envois sans livraison (marqueur gardé)`, async () => {
    const { sync, store, send } = setup([{ id: 'd0', endpoint: fcm('d0'), reply: 503 }]);
    for (let i = 0; i < MAX_UNDELIVERED_PUSH + 2; i++) await sync();
    expect(send).toHaveBeenCalledTimes(MAX_UNDELIVERED_PUSH);
    expect(store.get(PUSH_KEY)).toBe('breached');
  });
});

describe('Push prop firm : rien n’est parti, aucun essai consommé (revue #726 m10)', () => {
  // 16:00 UTC = 18:00 à Paris (juin) : dans la plage 17:00 à 20:00.
  const QUIET: Pref = { mutedTypes: [], quietStart: 17 * 60, quietEnd: 20 * 60 };
  const MUTED: Pref = { mutedTypes: ['PROP_RULES'], quietStart: null, quietEnd: null };
  // Le notifieur lit l'heure courante : figée sur celle du relevé.
  beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterAll(() => vi.useRealTimers());

  it.each([
    ['aucun appareil', [], null],
    ['type coupé', [{ id: 'd0', endpoint: fcm('d0'), reply: 201 }], MUTED],
    ['heures silencieuses', [{ id: 'd0', endpoint: fcm('d0'), reply: 201 }], QUIET],
  ] as [string, { id: string; endpoint: string; reply: Reply }[], Pref][])(
    '%s : aucun envoi, compteur jamais touché, réservation rendue à chaque relevé',
    async (_, devices, pref) => {
      const { sync, store, send, redis } = setup(devices, pref);
      for (let i = 0; i < MAX_UNDELIVERED_PUSH + 2; i++) await sync();
      expect(send).not.toHaveBeenCalled();
      expect(redis.client.incr).not.toHaveBeenCalled();
      expect([...store.keys()].some((k) => k.includes(':undelivered:'))).toBe(false);
      expect(store.has(PUSH_KEY)).toBe(false);
    },
  );
});

