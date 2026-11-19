import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AdminAuthService, NOT_ADMIN_MESSAGE } from './admin-auth.service';
import { environment } from '@admin/environments/environment';

const admin = { id: 'a1', email: 'admin@test.local', plan: 'PREMIUM', role: 'ADMIN' };

/**
 * #1103 : le refresh enregistrait le jeton et l'utilisateur renvoyés sans vérifier le rôle ADMIN,
 * contrairement au login (A18 #1065). Un compte qui a perdu le rôle gardait un jeton dans le navigateur.
 */
describe('AdminAuthService.refreshToken : rôle ADMIN exigé (#1103)', () => {
  let http: HttpTestingController;
  let auth: AdminAuthService;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('admin_access_token', 'ancien');
    localStorage.setItem('admin_user', JSON.stringify(admin));
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([{ path: 'login', children: [] }])] });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AdminAuthService);
  });
  afterEach(() => { http.verify(); localStorage.clear(); });

  it('compte ADMIN : nouveau jeton et utilisateur enregistrés', () => {
    let done = false;
    auth.refreshToken().subscribe(() => (done = true));
    http.expectOne(`${environment.apiUrl}/auth/refresh`).flush({ data: { access_token: 'nouveau', user: admin } });
    expect(done).toBe(true);
    expect(auth.getAccessToken()).toBe('nouveau');
    expect(auth.isAdmin()).toBe(true);
  });

  it('compte devenu USER : rien n’est enregistré, le refresh échoue (l’intercepteur déconnecte)', () => {
    let error: { status?: number; error?: { message?: string } } | undefined;
    auth.refreshToken().subscribe({ error: (e) => (error = e) });
    http.expectOne(`${environment.apiUrl}/auth/refresh`).flush({
      data: { access_token: 'jeton-user', user: { ...admin, role: 'USER' } },
    });
    expect(error?.status).toBe(403);
    expect(error?.error?.message).toBe(NOT_ADMIN_MESSAGE);
    expect(auth.getAccessToken()).toBe('ancien');
    expect(JSON.parse(localStorage.getItem('admin_user') ?? '{}').role).toBe('ADMIN');
    expect(auth.currentUser()?.role).toBe('ADMIN');
  });

  it('réponse sans utilisateur : refusée aussi (on ne garde pas un jeton dont le rôle est inconnu)', () => {
    let status: number | undefined;
    auth.refreshToken().subscribe({ error: (e) => (status = e.status) });
    http.expectOne(`${environment.apiUrl}/auth/refresh`).flush({ data: { access_token: 'jeton-inconnu' } });
    expect(status).toBe(403);
    expect(auth.getAccessToken()).toBe('ancien');
  });

  it('déconnexion pendant le refresh : la réponse arrivée après ne remet pas de jeton', () => {
    let emitted = false;
    auth.refreshToken().subscribe(() => (emitted = true));
    const refresh = http.expectOne(`${environment.apiUrl}/auth/refresh`);
    auth.logout();
    http.expectOne(`${environment.apiUrl}/auth/logout`).flush({});
    refresh.flush({ data: { access_token: 'tardif', user: admin } });
    expect(emitted).toBe(false);
    expect(auth.getAccessToken()).toBeNull();
    expect(localStorage.getItem('admin_user')).toBeNull();
    expect(auth.isAuthenticated()).toBe(false);
  });
});
