import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject, of, throwError } from 'rxjs';
import { AUTH_TOKEN_SOURCE, jwtRefreshInterceptor } from './jwt-refresh.interceptor';

describe('jwtRefreshInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let token: string | null;
  const auth = { getAccessToken: () => token, refreshToken: vi.fn(), logout: vi.fn() };

  beforeEach(() => {
    token = 'ancien';
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([jwtRefreshInterceptor])),
        provideHttpClientTesting(),
        { provide: AUTH_TOKEN_SOURCE, useValue: auth },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });
  afterEach(() => backend.verify());

  it('ajoute le JWT aux requêtes', () => {
    http.get('/api/trades').subscribe();
    expect(backend.expectOne('/api/trades').request.headers.get('Authorization')).toBe('Bearer ancien');
  });

  it('401 → refresh unique, puis la requête est rejouée avec le nouveau token', () => {
    auth.refreshToken.mockImplementation(() => {
      token = 'nouveau';
      return of(true);
    });
    let result: unknown;
    http.get('/api/trades').subscribe((r) => (result = r));
    backend.expectOne('/api/trades').flush({}, { status: 401, statusText: 'Unauthorized' });
    const retry = backend.expectOne('/api/trades');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer nouveau');
    retry.flush({ ok: true });
    expect(result).toEqual({ ok: true });
    expect(auth.refreshToken).toHaveBeenCalledOnce();
  });

  it('refresh en échec → déconnexion', () => {
    auth.refreshToken.mockReturnValue(throwError(() => ({ status: 401 })));
    http.get('/api/trades').subscribe({ error: () => undefined });
    backend.expectOne('/api/trades').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(auth.logout).toHaveBeenCalledOnce();
  });

  it('refresh en échec : les requêtes qui l’attendaient échouent aussi, aucune ne reste en suspens (#1065)', () => {
    const refresh = new Subject<unknown>();
    auth.refreshToken.mockReturnValue(refresh);
    const outcome: string[] = [];
    http.get('/api/trades').subscribe({ next: () => outcome.push('trades ok'), error: (e) => outcome.push(`trades ${e.status}`) });
    http.get('/api/stats').subscribe({ next: () => outcome.push('stats ok'), error: (e) => outcome.push(`stats ${e.status}`) });
    backend.expectOne('/api/trades').flush({}, { status: 401, statusText: 'Unauthorized' });
    backend.expectOne('/api/stats').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(auth.refreshToken).toHaveBeenCalledOnce();

    refresh.error({ status: 401 });
    expect(outcome.sort()).toEqual(['stats 401', 'trades 401']);
    expect(auth.logout).toHaveBeenCalledOnce();
  });

  it('requête à l’origine du refresh annulée : l’état est libéré, le 401 suivant relance un refresh', () => {
    auth.refreshToken.mockReturnValueOnce(new Subject<unknown>());
    const sub = http.get('/api/trades').subscribe({ error: () => undefined });
    let waiterStatus: number | undefined;
    http.get('/api/waiter').subscribe({ error: (e) => (waiterStatus = e.status) });
    backend.expectOne('/api/trades').flush({}, { status: 401, statusText: 'Unauthorized' });
    backend.expectOne('/api/waiter').flush({}, { status: 401, statusText: 'Unauthorized' });
    sub.unsubscribe();
    // La requête qui attendait reçoit l'erreur d'origine au lieu de rester en suspens.
    expect(waiterStatus).toBe(401);

    auth.refreshToken.mockImplementationOnce(() => {
      token = 'nouveau';
      return of(true);
    });
    let result: unknown;
    http.get('/api/stats').subscribe((r) => (result = r));
    backend.expectOne('/api/stats').flush({}, { status: 401, statusText: 'Unauthorized' });
    backend.expectOne('/api/stats').flush({ ok: true });
    expect(result).toEqual({ ok: true });
    expect(auth.refreshToken).toHaveBeenCalledTimes(2);
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('requête rejouée en erreur (500) : erreur renvoyée, pas de déconnexion', () => {
    auth.refreshToken.mockImplementation(() => {
      token = 'nouveau';
      return of(true);
    });
    let status: number | undefined;
    http.get('/api/trades').subscribe({ error: (e) => (status = e.status) });
    backend.expectOne('/api/trades').flush({}, { status: 401, statusText: 'Unauthorized' });
    backend.expectOne('/api/trades').flush({}, { status: 500, statusText: 'Server Error' });
    expect(status).toBe(500);
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('deux refresh qui se suivent : l’issue de la requête rejouée du 1er ne touche pas le 2e', () => {
    const refreshB = new Subject<unknown>();
    auth.refreshToken
      .mockImplementationOnce(() => { token = 'jeton-a'; return of(true); })
      .mockReturnValueOnce(refreshB);
    let aStatus: number | undefined;
    let waiter: unknown;
    http.get('/api/a').subscribe({ error: (e) => (aStatus = e.status) });
    http.get('/api/c').subscribe();
    backend.expectOne('/api/a').flush({}, { status: 401, statusText: 'Unauthorized' });
    const replayA = backend.expectOne('/api/a'); // refresh A réussi, requête rejouée en vol

    // 401 tardif de C (parti avec l'ancien jeton) → refresh B ; D l'attend.
    backend.expectOne('/api/c').flush({}, { status: 401, statusText: 'Unauthorized' });
    http.get('/api/d').subscribe((r) => (waiter = r));
    backend.expectOne('/api/d').flush({}, { status: 401, statusText: 'Unauthorized' });

    replayA.flush({}, { status: 500, statusText: 'Server Error' });
    expect(aStatus).toBe(500);
    expect(auth.logout).not.toHaveBeenCalled();

    token = 'jeton-b';
    refreshB.next(true);
    refreshB.complete();
    backend.expectOne('/api/c').flush({});
    const replayD = backend.expectOne('/api/d');
    expect(replayD.request.headers.get('Authorization')).toBe('Bearer jeton-b');
    replayD.flush({ ok: true });
    expect(waiter).toEqual({ ok: true });
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('refresh réussi : la requête qui l’attendait est rejouée avec le nouveau jeton', () => {
    const refresh = new Subject<unknown>();
    auth.refreshToken.mockReturnValue(refresh);
    let stats: unknown;
    http.get('/api/trades').subscribe();
    http.get('/api/stats').subscribe((r) => (stats = r));
    backend.expectOne('/api/trades').flush({}, { status: 401, statusText: 'Unauthorized' });
    backend.expectOne('/api/stats').flush({}, { status: 401, statusText: 'Unauthorized' });
    token = 'nouveau';
    refresh.next(true);
    refresh.complete();
    backend.expectOne('/api/trades').flush({});
    const retry = backend.expectOne('/api/stats');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer nouveau');
    retry.flush({ ok: true });
    expect(stats).toEqual({ ok: true });
  });

  it('mauvais mot de passe (401 sur /auth/login) : ni refresh ni déconnexion', () => {
    let status: number | undefined;
    http.post('/api/auth/login', {}).subscribe({ error: (e) => (status = e.status) });
    const login = backend.expectOne('/api/auth/login');
    expect(login.request.headers.has('Authorization')).toBe(false);
    login.flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(status).toBe(401);
    expect(auth.refreshToken).not.toHaveBeenCalled();
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('connexion Google (POST /auth/google) : sans jeton, 401 renvoyé tel quel', () => {
    http.post('/api/auth/google', {}).subscribe({ error: () => undefined });
    const req = backend.expectOne('/api/auth/google');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(auth.refreshToken).not.toHaveBeenCalled();
  });

  it('finalisation et déliaison Google gardent le jeton (routes connectées)', () => {
    http.post('/api/auth/google/finalize', {}).subscribe();
    http.delete('/api/auth/google').subscribe();
    expect(backend.expectOne('/api/auth/google/finalize').request.headers.get('Authorization')).toBe('Bearer ancien');
    expect(backend.expectOne((r) => r.method === 'DELETE').request.headers.get('Authorization')).toBe('Bearer ancien');
  });
});
