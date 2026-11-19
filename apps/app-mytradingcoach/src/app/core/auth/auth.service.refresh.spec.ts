import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from './auth.service';
import { environment } from '@app/environments/environment';

const user = { id: 'u1', email: 'trader@test.local', plan: 'FREE', role: 'USER' };

/**
 * #1103 : le refresh partagé de `@mtc/front-auth` va au bout même si plus aucune requête ne l'attend.
 * Une réponse arrivée après une déconnexion ne doit pas remettre de jeton dans le navigateur.
 */
describe('AuthService.refreshToken : déconnexion pendant le refresh (#1103)', () => {
  let http: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('access_token', 'ancien');
    localStorage.setItem('user', JSON.stringify(user));
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([{ path: 'login', children: [] }])],
    });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
  });
  afterEach(() => { http.verify(); localStorage.clear(); });

  it('refresh normal : nouveau jeton gardé', () => {
    auth.refreshToken().subscribe();
    http.expectOne(`${environment.apiUrl}/auth/refresh`).flush({ data: { access_token: 'nouveau', user } });
    expect(auth.getAccessToken()).toBe('nouveau');
  });

  it('réponse arrivée après la déconnexion : rien n’est réécrit ni émis', () => {
    let emitted = false;
    auth.refreshToken().subscribe(() => (emitted = true));
    const refresh = http.expectOne(`${environment.apiUrl}/auth/refresh`);
    auth.logout();
    http.expectOne(`${environment.apiUrl}/auth/logout`).flush({});
    refresh.flush({ data: { access_token: 'tardif', user } });
    expect(emitted).toBe(false);
    expect(auth.getAccessToken()).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(auth.currentUser()).toBeNull();
  });
});
