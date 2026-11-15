import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { UserStore } from '../stores/user.store';
import { PostSignupService } from './post-signup.service';
import { isSafeReturnUrl, takeReturnUrl } from './return-url';

/**
 * Audit fonctionnel #994 (lot 1d, F11) : déconnecté, un lien d'e-mail ou de push (`/profil#…`,
 * `/session`) menait, après connexion, au tableau de bord : la page demandée était perdue.
 */
describe('Page demandée retrouvée après la connexion', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'login', children: [] }]),
        provideHttpClient(),
        { provide: AuthService, useValue: { currentUser: signal(null), isAuthenticated: signal(false) } },
        UserStore,
      ],
    });
  });

  it('le garde mémorise la page refusée, la connexion y ramène', () => {
    TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, { url: '/session' } as RouterStateSnapshot),
    );
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    TestBed.inject(PostSignupService).afterLogin();
    expect(nav).toHaveBeenCalledWith('/session');
    expect(takeReturnUrl()).toBeNull(); // consommée une seule fois
  });

  it('aucune page mémorisée → tableau de bord', () => {
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    TestBed.inject(PostSignupService).afterLogin();
    expect(nav).toHaveBeenCalledWith(['/dashboard']);
  });

  it.each(['https://evil.example/x', '//evil.example', '/\\evil', 'javascript:alert(1)', '/login?x=1'])(
    'URL refusée : %s',
    (url) => expect(isSafeReturnUrl(url)).toBe(false),
  );

  it.each(['/session', '/profil#notifications', '/paiement?plan=premium'])('URL interne acceptée : %s', (url) =>
    expect(isSafeReturnUrl(url)).toBe(true),
  );
});
