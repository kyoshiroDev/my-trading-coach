import { describe, it, expect, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
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
