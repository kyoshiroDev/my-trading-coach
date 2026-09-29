import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
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
});
