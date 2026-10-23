import { describe, it, expect, vi, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { PUSH_BROWSER, type PushBrowser } from './push-browser';
import { PushLogout } from './push-logout';

/**
 * Déconnexion (revue #717, m2) : l'abonnement push de CET appareil est retiré côté API, avec le
 * jeton d'avant la déconnexion, PUIS côté navigateur. Sans ça, sur un appareil partagé, les
 * alertes d'un compte arriveraient chez la personne suivante.
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
  localStorage.clear();
  TestBed.resetTestingModule();
});

describe('PushLogout', () => {
  it('retire l’appareil côté API avec le jeton fourni, puis côté navigateur', async () => {
    const unsubscribe = vi.fn(async () => true);
    const { http } = setup({ endpoint: ENDPOINT, unsubscribe });
    const done = TestBed.inject(PushLogout).run('jeton-avant');
    await flush();
    const req = http.expectOne((r) => r.url.endsWith('/push/unsubscribe'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ endpoint: ENDPOINT });
    expect(req.request.headers.get('Authorization')).toBe('Bearer jeton-avant');
    expect(unsubscribe).not.toHaveBeenCalled(); // l'API d'abord
    req.flush({ removed: true });
    await done;
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('API en erreur : le navigateur est désabonné quand même, sans lever', async () => {
    const unsubscribe = vi.fn(async () => true);
    const { http } = setup({ endpoint: ENDPOINT, unsubscribe });
    const done = TestBed.inject(PushLogout).run('jeton');
    await flush();
    http.expectOne((r) => r.url.endsWith('/push/unsubscribe')).flush('panne', { status: 500, statusText: 'Erreur' });
    await expect(done).resolves.toBeUndefined();
    expect(unsubscribe).toHaveBeenCalledOnce();
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
    TestBed.inject(AuthService).logout();
    expect(localStorage.getItem('access_token')).toBeNull();
    await flush();
    const req = http.expectOne((r) => r.url.endsWith('/push/unsubscribe'));
    expect(req.request.headers.get('Authorization')).toBe('Bearer jeton-de-session');
    req.flush({ removed: true });
    await flush();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
