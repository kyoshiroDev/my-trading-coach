import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { signal } from '@angular/core';
import { authGuard, premiumGuard } from './auth.guard';
import { AuthService, AuthUser } from './auth.service';
import { UserStore } from '../stores/user.store';
import { provideHttpClient } from '@angular/common/http';

const makeAuthMock = (authenticated: boolean, premium: boolean) => ({
  currentUser: signal<AuthUser | null>(
    authenticated ? { id: '1', email: 'test@test.com', plan: premium ? 'PREMIUM' : 'FREE' } : null,
  ),
  isAuthenticated: signal(authenticated),
  fetchMe: vi.fn(),
  refreshUser: vi.fn(),
  setCurrentUser: vi.fn(),
});

const setupTestBed = (authMock: ReturnType<typeof makeAuthMock>) => {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      { provide: AuthService, useValue: authMock },
      UserStore,
    ],
  });
};

describe('authGuard', () => {
  it('retourne true si utilisateur authentifié', () => {
    setupTestBed(makeAuthMock(true, false));
    const result = TestBed.runInInjectionContext(() => authGuard({} as unknown as ActivatedRouteSnapshot, {} as unknown as RouterStateSnapshot));
    expect(result).toBe(true);
  });

  it('redirige vers /login si non authentifié', () => {
    setupTestBed(makeAuthMock(false, false));
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    TestBed.runInInjectionContext(() => authGuard({} as unknown as ActivatedRouteSnapshot, {} as unknown as RouterStateSnapshot));

    expect(navigateSpy).toHaveBeenCalledWith(['/login']);
  });

  it('retourne false si non authentifié', () => {
    setupTestBed(makeAuthMock(false, false));
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const result = TestBed.runInInjectionContext(() => authGuard({} as unknown as ActivatedRouteSnapshot, {} as unknown as RouterStateSnapshot));
    expect(result).toBe(false);
  });
});

describe('premiumGuard', () => {
  it('retourne true si authentifié ET premium', () => {
    setupTestBed(makeAuthMock(true, true));
    const result = TestBed.runInInjectionContext(() => premiumGuard({} as unknown as ActivatedRouteSnapshot, {} as unknown as RouterStateSnapshot));
    expect(result).toBe(true);
  });

  it('redirige vers /settings si authentifié mais pas premium', () => {
    setupTestBed(makeAuthMock(true, false));
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    TestBed.runInInjectionContext(() => premiumGuard({} as unknown as ActivatedRouteSnapshot, {} as unknown as RouterStateSnapshot));

    expect(navigateSpy).toHaveBeenCalledWith(['/settings']);
  });

  it('retourne false si non premium', () => {
    setupTestBed(makeAuthMock(true, false));
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const result = TestBed.runInInjectionContext(() => premiumGuard({} as unknown as ActivatedRouteSnapshot, {} as unknown as RouterStateSnapshot));
    expect(result).toBe(false);
  });

  it('retourne false si non authentifié', () => {
    setupTestBed(makeAuthMock(false, false));
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const result = TestBed.runInInjectionContext(() => premiumGuard({} as unknown as ActivatedRouteSnapshot, {} as unknown as RouterStateSnapshot));
    expect(result).toBe(false);
  });
});
