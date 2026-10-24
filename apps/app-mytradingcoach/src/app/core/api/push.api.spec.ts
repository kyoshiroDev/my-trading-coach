import { describe, it, expect, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SILENT_ERRORS } from '@mtc/front-ui';
import { PushApi } from './push.api';

/** Requêtes `/push/*` de l'app (#666 phase 2). */

function setup() {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  return { api: TestBed.inject(PushApi), http: TestBed.inject(HttpTestingController) };
}

afterEach(() => TestBed.resetTestingModule());

describe('PushApi : annulation (revue phase 2 I2)', () => {
  it('signal annulé pendant la requête : requête coupée, promesse rejetée', async () => {
    const { api, http } = setup();
    const ctrl = new AbortController();
    const pending = api.settings(ctrl.signal);
    const req = http.expectOne((r) => r.url.endsWith('/push/settings'));
    ctrl.abort();
    await expect(pending).rejects.toBeDefined();
    expect(req.cancelled).toBe(true);
  });

  it('signal déjà annulé : aucune requête envoyée', async () => {
    const { api, http } = setup();
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(api.preferences({ mutedTypes: [] }, ctrl.signal)).rejects.toBeDefined();
    http.expectNone(() => true);
  });

  it('sans signal : réponse lue normalement', async () => {
    const { api, http } = setup();
    const pending = api.test();
    http.expectOne((r) => r.url.endsWith('/push/test')).flush({ data: { subscriptions: 1, delivered: 1, failed: 0, removed: 0 } });
    expect((await pending).delivered).toBe(1);
  });
});

describe('PushApi : un seul message par erreur (revue phase 2 m2)', () => {
  it('chaque appel est en SILENT_ERRORS : pas de toast global en plus de celui de la section', async () => {
    const { api, http } = setup();
    const calls = [
      api.settings(), api.device('https://fcm.googleapis.com/fcm/send/x'),
      api.subscribe({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', expirationTime: null, keys: { p256dh: 'k', auth: 'a' } }),
      api.removeDevice('d1'), api.preferences({ mutedTypes: [] }), api.test(),
    ];
    const reqs = http.match(() => true);
    expect(reqs).toHaveLength(6);
    for (const req of reqs) {
      expect(req.request.context.get(SILENT_ERRORS), req.request.url).toBe(true);
      req.flush('', { status: 429, statusText: 'Too Many Requests' });
    }
    await Promise.allSettled(calls);
  });
});
