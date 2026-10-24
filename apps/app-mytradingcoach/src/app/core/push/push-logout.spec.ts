import { describe, it, expect, vi, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, type TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { PUSH_BROWSER, type PushBrowser } from './push-browser';
import { PUSH_LOGOUT_TIMEOUT_MS, PushLogout } from './push-logout';

/**
 * Déconnexion (revue #717, m2 ; revue phase 2 I6) : l'abonnement push de CET appareil est retiré
 * côté navigateur D'ABORD (local, sans réseau), puis côté API avec le jeton d'avant la
 * déconnexion, en 5 s au plus et en `keepalive`. Sans ça, sur un appareil partagé, les alertes
 * d'un compte arriveraient chez la personne suivante.
 */

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';

function setup(sub: { endpoint: string; unsubscribe: () => Promise<boolean> } | null) {
  const browser: PushBrowser = {
    env: () => { throw new Error('non utilisé'); },
    currentSubscription: vi.fn(async () => sub as unknown as PushSubscription | null),
    subscribe: vi.fn(),
  };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([{ path: 'login', children: [] }]),
      { provide: PUSH_BROWSER, useValue: browser },
    ],
  });
  return { http: TestBed.inject(HttpTestingController), browser };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  TestBed.resetTestingModule();
});

describe('PushLogout', () => {
  it('navigateur désabonné d’abord, sans réseau, puis appareil retiré côté API avec le jeton fourni', async () => {
    const unsubscribe = vi.fn(async () => true);
    const { http } = setup({ endpoint: ENDPOINT, unsubscribe });
    const done = TestBed.inject(PushLogout).run('jeton-avant');
    await flush();
    expect(unsubscribe).toHaveBeenCalledOnce(); // avant même que la requête parte
    const req = http.expectOne((r) => r.url.endsWith('/push/unsubscribe'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ endpoint: ENDPOINT });
    expect(req.request.headers.get('Authorization')).toBe('Bearer jeton-avant');
    req.flush({ removed: true });
    await expect(done).resolves.toBeUndefined();
  });

  it('onglet fermé pendant la requête : navigateur déjà désabonné, requête en keepalive', async () => {
    const unsubscribe = vi.fn(async () => true);
    const { http } = setup({ endpoint: ENDPOINT, unsubscribe });
    void TestBed.inject(PushLogout).run('jeton');
    await flush();
    const req = http.expectOne((r) => r.url.endsWith('/push/unsubscribe'));
    expect(req.request.keepalive).toBe(true);
    // L'onglet se ferme ici : la réponse n'arrive jamais, le navigateur ne recevra plus rien.
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('réseau lent : abandon au bout de 5 s, requête coupée, sans lever', async () => {
    vi.useFakeTimers();
    const unsubscribe = vi.fn(async () => true);
    const { http } = setup({ endpoint: ENDPOINT, unsubscribe });
    let settled = false;
    void TestBed.inject(PushLogout).run('jeton').then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    const req = http.expectOne((r) => r.url.endsWith('/push/unsubscribe'));
    await vi.advanceTimersByTimeAsync(PUSH_LOGOUT_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    expect(req.cancelled).toBe(true);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it.each([
    ['réseau coupé', (req: TestRequest) => req.error(new ProgressEvent('error'))],
    ['jeton expiré (401)', (req: TestRequest) => req.flush('', { status: 401, statusText: 'Unauthorized' })],
    ['erreur serveur (500)', (req: TestRequest) => req.flush('panne', { status: 500, statusText: 'Erreur' })],
  ])('%s : navigateur désabonné quand même, sans lever', async (_, fail) => {
    const unsubscribe = vi.fn(async () => true);
    const { http } = setup({ endpoint: ENDPOINT, unsubscribe });
    const done = TestBed.inject(PushLogout).run('jeton');
    await flush();
    fail(http.expectOne((r) => r.url.endsWith('/push/unsubscribe')));
    await expect(done).resolves.toBeUndefined();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('désabonnement du navigateur en échec : l’API est appelée quand même', async () => {
    const unsubscribe = vi.fn(async () => { throw new Error('InvalidStateError'); });
    const { http } = setup({ endpoint: ENDPOINT, unsubscribe });
    const done = TestBed.inject(PushLogout).run('jeton');
    await flush();
    http.expectOne((r) => r.url.endsWith('/push/unsubscribe')).flush({ removed: true });
    await expect(done).resolves.toBeUndefined();
  });

  it('sans jeton : navigateur désabonné, aucun appel', async () => {
    const unsubscribe = vi.fn(async () => true);
    const { http } = setup({ endpoint: ENDPOINT, unsubscribe });
    await TestBed.inject(PushLogout).run(null);
    expect(unsubscribe).toHaveBeenCalledOnce();
    http.expectNone((r) => r.url.endsWith('/push/unsubscribe'));
  });

  it('aucun abonnement sur cet appareil : aucun appel', async () => {
    const { http } = setup(null);
    await TestBed.inject(PushLogout).run('jeton');
    http.expectNone((r) => r.url.endsWith('/push/unsubscribe'));
  });
});

describe('AuthService.logout → désabonnement push', () => {
  it('capture le jeton AVANT de l’effacer et retire l’abonnement de cet appareil', async () => {
    const unsubscribe = vi.fn(async () => true);
    const { http } = setup({ endpoint: ENDPOINT, unsubscribe });
    localStorage.setItem('access_token', 'jeton-de-session');
    const auth = TestBed.inject(AuthService);
    auth.logout();
    // Déconnexion jamais retenue par le push : session effacée tout de suite.
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(auth.isAuthenticated()).toBe(false);
    await flush();
    expect(unsubscribe).toHaveBeenCalledOnce();
    const req = http.expectOne((r) => r.url.endsWith('/push/unsubscribe'));
    expect(req.request.headers.get('Authorization')).toBe('Bearer jeton-de-session');
    req.flush({ removed: true });
  });
});
