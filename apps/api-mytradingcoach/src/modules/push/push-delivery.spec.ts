import { describe, it, expect, vi } from 'vitest';
import { deliverPush, pushStatusClass, type PushDeliveryTarget } from './push-delivery';
import { PushDeadlineError } from './push-http';
import type { PushSender } from './push-sender';

/**
 * Journal d'envoi push (test réel du 25/10 sur dev : un envoi réussi ne laissait aucune trace).
 * Une ligne info par tentative : type, résultat, classe de code, hôte. Jamais l'adresse
 * d'abonnement, ses clés ni l'identifiant de l'appareil.
 */

const TOKEN = 'dGhpcy1pcy1hLXNlY3JldC1mY20tdG9rZW4tZm9yLXRlc3Rz';
const P256DH = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
const AUTH = 'tBHItJI5svbpez7KI4CCXg';
const DEVICE_ID = 'cmvnsmehb000a01mhi8jc4kq2';
const target: PushDeliveryTarget = { id: DEVICE_ID, endpoint: `https://fcm.googleapis.com/fcm/send/${TOKEN}`, p256dh: P256DH, auth: AUTH };

async function attempt(send: PushSender['send']) {
  const logger = { log: vi.fn(), warn: vi.fn() };
  const store = { delivered: vi.fn().mockResolvedValue(undefined), gone: vi.fn().mockResolvedValue(undefined) };
  const report = await deliverPush({ send: vi.fn(send) }, [target], '{"title":"t"}', { ttlSeconds: 60, urgency: 'normal' }, store, logger, 'trader', 'PROP_RULES');
  const lines = [...logger.log.mock.calls, ...logger.warn.mock.calls].map((c) => String(c[0]));
  return { report, lines, logger, store };
}

/** Livré et abonnement mort (404/410, fonctionnement normal) en info ; tout autre échec en warn. */
const CASES: [string, PushSender['send'], string, 'log' | 'warn'][] = [
  ['succès 201', async () => 201, 'Envoi push trader PROP_RULES : livré (2xx, fcm.googleapis.com)', 'log'],
  ['404', async () => 404, 'Envoi push trader PROP_RULES : échec (404, fcm.googleapis.com), abonnement supprimé', 'log'],
  ['410', async () => 410, 'Envoi push trader PROP_RULES : échec (410, fcm.googleapis.com), abonnement supprimé', 'log'],
  ['5xx', async () => 503, 'Envoi push trader PROP_RULES : échec (5xx, fcm.googleapis.com)', 'warn'],
  ['4xx (413, 429…)', async () => 429, 'Envoi push trader PROP_RULES : échec (4xx, fcm.googleapis.com)', 'warn'],
  ['délai dépassé', async () => { throw new PushDeadlineError(10_000); }, 'Envoi push trader PROP_RULES : échec (délai dépassé, fcm.googleapis.com)', 'warn'],
  // Message d'erreur qui citerait l'adresse : jamais repris.
  ['erreur réseau', async () => { throw new Error(`connect ECONNRESET ${target.endpoint}`); }, 'Envoi push trader PROP_RULES : échec (erreur réseau, fcm.googleapis.com)', 'warn'],
];

describe('deliverPush — une ligne de journal par tentative', () => {
  it.each(CASES)('%s : exactement une ligne, au bon niveau, contenu attendu', async (_, send, expected, level) => {
    const { lines, logger } = await attempt(send);
    const other = level === 'log' ? 'warn' : 'log';

    expect(lines).toEqual([expected]);
    expect(logger[level], `ligne attendue au niveau ${level}`).toHaveBeenCalledTimes(1);
    expect(logger[other]).not.toHaveBeenCalled();
  });

  it.each(CASES)('%s : ni adresse d’abonnement, ni clé, ni identifiant dans le texte journalisé', async (_, send) => {
    const { lines } = await attempt(send);
    const text = lines.join('\n');

    for (const secret of [target.endpoint, TOKEN, '/fcm/send/', P256DH, AUTH, DEVICE_ID]) {
      expect(text, `fuite dans le journal : ${secret.slice(0, 12)}…`).not.toContain(secret);
    }
  });

  it('bilan et écritures en base inchangés : 2xx livré, 404/410 supprimé, le reste en échec', async () => {
    expect((await attempt(async () => 201)).report).toEqual({ subscriptions: 1, delivered: 1, failed: 0, removed: 0 });
    const gone = await attempt(async () => 410);
    expect(gone.report).toEqual({ subscriptions: 1, delivered: 0, failed: 0, removed: 1 });
    expect(gone.store.gone).toHaveBeenCalledWith(DEVICE_ID);
    expect((await attempt(async () => 503)).report).toEqual({ subscriptions: 1, delivered: 0, failed: 1, removed: 0 });
    expect((await attempt(async () => { throw new PushDeadlineError(10_000); })).report.failed).toBe(1);
  });

  it('plusieurs appareils : une ligne chacun', async () => {
    const logger = { log: vi.fn(), warn: vi.fn() };
    const store = { delivered: vi.fn().mockResolvedValue(undefined), gone: vi.fn().mockResolvedValue(undefined) };
    const apple = { ...target, id: 'd2', endpoint: `https://web.push.apple.com/${TOKEN}` };
    const send = vi.fn().mockResolvedValueOnce(201).mockResolvedValueOnce(410);
    await deliverPush({ send }, [target, apple], '{}', { ttlSeconds: 60, urgency: 'normal' }, store, logger, 'trader', 'TEST');

    expect(logger.log).toHaveBeenCalledTimes(2);
  });
});

describe('pushStatusClass', () => {
  it.each([[200, '2xx'], [201, '2xx'], [302, '3xx'], [400, '4xx'], [404, '404'], [410, '410'], [500, '5xx'], [503, '5xx']])('%i → %s', (status, cls) => {
    expect(pushStatusClass(status)).toBe(cls);
  });
});
