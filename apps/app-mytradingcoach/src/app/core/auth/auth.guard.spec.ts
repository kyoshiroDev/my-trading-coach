import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { authGuard, premiumGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { provideHttpClient } from '@angular/common/http';

const makeAuthMock = (authenticated: boolean, premium: boolean) => ({
  currentUser: signal(
    authenticated ? { id: '1', email: 'test@test.com', plan: premium ? 'PREMIUM' : 'FREE' } : null,
  ),
  isAuthenticated: signal(authenticated),
  isPremium: vi.fn().mockReturnValue(premium),
});

const setupTestBed = (authMock: ReturnType<typeof makeAuthMock>) => {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      { provide: AuthService, useValue: authMock },
    ],
  });
};

describe('authGuard', () => {
  it('retourne true si utilisateur authentifié', () => {
    setupTestBed(makeAuthMock(true, false));
    const result = TestBed.runInInjectionContext(() => authGuard({} as any, {} as any));
    expect(result).toBe(true);
  });

  it('redirige vers /login si non authentifié', () => {
    setupTestBed(makeAuthMock(false, false));
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    TestBed.runInInjectionContext(() => authGuard({} as any, {} as any));

    expect(navigateSpy).toHaveBeenCalledWith(['/login']);
  });

  it('retourne false si non authentifié', () => {
    setupTestBed(makeAuthMock(false, false));
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const result = TestBed.runInInjectionContext(() => authGuard({} as any, {} as any));
    expect(result).toBe(false);
  });
});

describe('premiumGuard', () => {
  it('retourne true si authentifié ET premium', () => {
    setupTestBed(makeAuthMock(true, true));

    const result = TestBed.runInInjectionContext(() => premiumGuard({} as any, {} as any));
    expect(result).toBe(true);
  });

  it('redirige vers /dashboard si authentifié mais pas premium', () => {
    setupTestBed(makeAuthMock(true, false));
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    TestBed.runInInjectionContext(() => premiumGuard({} as any, {} as any));

    expect(navigateSpy).toHaveBeenCalledWith(['/settings']);
  });

  it('retourne false si non premium', () => {
    setupTestBed(makeAuthMock(true, false));
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const result = TestBed.runInInjectionContext(() => premiumGuard({} as any, {} as any));
    expect(result).toBe(false);
  });

  it('retourne false si non authentifié', () => {
    setupTestBed(makeAuthMock(false, false));
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const result = TestBed.runInInjectionContext(() => premiumGuard({} as any, {} as any));
    expect(result).toBe(false);
  });
});
