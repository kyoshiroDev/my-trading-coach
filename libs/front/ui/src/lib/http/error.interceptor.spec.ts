import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  HttpContext,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ERROR_NOTIFIER } from './error-notifier';
import { SILENT_ERRORS } from './silent-errors';
import { errorInterceptor } from './error.interceptor';

/**
 * « Aucune erreur API silencieuse » : une panne que l'écran ne sait pas expliquer doit être dite à
 * l'utilisateur. Mais seulement celles-là — un 4xx métier est déjà traité là où il se produit, et
 * un toast par-dessus ne dirait rien de plus.
 */
describe('errorInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  const notifier = { error: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: ERROR_NOTIFIER, useValue: notifier },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });
  afterEach(() => backend.verify());

  /** Déclenche une requête en avalant l'erreur : c'est l'intercepteur qu'on observe, pas l'appelant. */
  const echec = (status: number, body: Record<string, unknown> = {}) => {
    http.get('/api/trades').subscribe({ error: () => undefined });
    backend.expectOne('/api/trades').flush(body, { status, statusText: `HTTP ${status}` });
  };

  it('500 → notifie, sans jamais afficher le message technique du serveur', () => {
    echec(500, { message: 'Internal server error' });
    expect(notifier.error).toHaveBeenCalledTimes(1);
    const message = notifier.error.mock.calls[0][0] as string;
    expect(message).toBe('Le serveur a rencontré un problème. Réessaie dans un instant.');
    expect(message).not.toContain('Internal');
  });

  it('503 → garde le message du back, rédigé pour l’utilisateur', () => {
    echec(503, { message: "La connexion Tradovate n'est pas encore disponible." });
    expect(notifier.error).toHaveBeenCalledWith("La connexion Tradovate n'est pas encore disponible.");
  });

  it('429 → notifie que le débit est limité', () => {
    echec(429);
    expect(notifier.error).toHaveBeenCalledTimes(1);
    expect(notifier.error.mock.calls[0][0]).toContain('Patiente');
  });

  it('réseau injoignable (status 0) → parle de la connexion, pas du serveur', () => {
    http.get('/api/trades').subscribe({ error: () => undefined });
    backend.expectOne('/api/trades').error(new ProgressEvent('error'), { status: 0, statusText: '' });
    expect(notifier.error).toHaveBeenCalledTimes(1);
    expect(notifier.error.mock.calls[0][0]).toContain('Connexion au serveur impossible');
  });

  it('4xx métier → aucune notification, l’écran s’en charge', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      echec(status, { message: 'peu importe' });
    }
    expect(notifier.error).not.toHaveBeenCalled();
  });

  it('requête marquée silencieuse → aucune notification même sur un 500', () => {
    const context = new HttpContext().set(SILENT_ERRORS, true);
    http.get('/api/trades', { context }).subscribe({ error: () => undefined });
    backend.expectOne('/api/trades').flush({}, { status: 500, statusText: 'Server Error' });
    expect(notifier.error).not.toHaveBeenCalled();
  });

  it('l’erreur est toujours relancée : notifier n’est pas traiter', () => {
    let recue: unknown = null;
    http.get('/api/trades').subscribe({ error: (e) => (recue = e) });
    backend.expectOne('/api/trades').flush({}, { status: 500, statusText: 'Server Error' });
    expect((recue as { status?: number } | null)?.status).toBe(500);
  });

  it('succès → aucune notification', () => {
    http.get('/api/trades').subscribe();
    backend.expectOne('/api/trades').flush({ ok: true });
    expect(notifier.error).not.toHaveBeenCalled();
  });
});

describe('errorInterceptor sans notifieur fourni', () => {
  it('ne casse pas : l’admin n’a pas encore de toast (UI-11)', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    const http = TestBed.inject(HttpClient);
    const backend = TestBed.inject(HttpTestingController);
    let recue: unknown = null;
    http.get('/api/x').subscribe({ error: (e) => (recue = e) });
    backend.expectOne('/api/x').flush({}, { status: 500, statusText: 'Server Error' });
    expect((recue as { status?: number } | null)?.status).toBe(500);
    backend.verify();
  });
});
