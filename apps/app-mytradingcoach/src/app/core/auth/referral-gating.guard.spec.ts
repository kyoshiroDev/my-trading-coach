import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { parrainageGuard, ambassadorPageGuard } from './referral-gating.guard';
import { AuthService, AuthUser } from './auth.service';
import { UserStore } from '../stores/user.store';

type Role = 'ADMIN' | 'USER' | 'BETA_TESTER' | 'AMBASSADOR';

const setup = (role: Role) => {
  const authMock = {
    currentUser: signal<AuthUser | null>({
      id: '1',
      email: 'test@test.com',
      plan: 'FREE',
      role,
    } as unknown as AuthUser),
    isAuthenticated: signal(true),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      { provide: AuthService, useValue: authMock },
      UserStore,
    ],
  });
};

const run = (guard: typeof parrainageGuard) =>
  TestBed.runInInjectionContext(() =>
     
    guard({} as any, {} as any),
  );

const target = (result: boolean | UrlTree): string | boolean => {
  if (result instanceof UrlTree) {
    return TestBed.inject(Router).serializeUrl(result);
  }
  return result;
};

describe('parrainageGuard', () => {
  it('laisse passer un utilisateur non-ambassadeur', () => {
    setup('USER');
    expect(target(run(parrainageGuard) as boolean | UrlTree)).toBe(true);
  });

  it('redirige un ambassadeur (non-admin) vers /ambassador', () => {
    setup('AMBASSADOR');
    expect(target(run(parrainageGuard) as boolean | UrlTree)).toBe('/ambassador');
  });

  it('laisse passer un admin (accès aux deux surfaces)', () => {
    setup('ADMIN');
    expect(target(run(parrainageGuard) as boolean | UrlTree)).toBe(true);
  });
});

describe('ambassadorPageGuard', () => {
  it('laisse passer un ambassadeur', () => {
    setup('AMBASSADOR');
    expect(target(run(ambassadorPageGuard) as boolean | UrlTree)).toBe(true);
  });

  it('redirige un non-ambassadeur vers /parrainage', () => {
    setup('USER');
    expect(target(run(ambassadorPageGuard) as boolean | UrlTree)).toBe('/parrainage');
  });

  it('laisse passer un admin (super-rôle ambassadeur)', () => {
    setup('ADMIN');
    expect(target(run(ambassadorPageGuard) as boolean | UrlTree)).toBe(true);
  });
});
