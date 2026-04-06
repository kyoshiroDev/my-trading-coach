import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { UserStore } from './user.store';
import { AuthService, AuthUser } from '../auth/auth.service';

const makeAuthServiceMock = (initialUser: AuthUser | null = null) => {
  const currentUser = signal<AuthUser | null>(initialUser);
  return {
    currentUser,
    isAuthenticated: signal(initialUser !== null),
    isPremium: () => currentUser()?.plan === 'PREMIUM',
  };
};

describe('UserStore', () => {
  let store: UserStore;
  let mockAuth: ReturnType<typeof makeAuthServiceMock>;

  beforeEach(() => {
    mockAuth = makeAuthServiceMock(null);

    TestBed.configureTestingModule({
      providers: [
        UserStore,
        { provide: AuthService, useValue: mockAuth },
      ],
    });

    store = TestBed.inject(UserStore);
  });

  describe('isPremium', () => {
    it('retourne false si aucun utilisateur connecté', () => {
      expect(store.isPremium()).toBe(false);
    });

    it('retourne false pour plan FREE sans trial', () => {
      mockAuth.currentUser.set({ id: '1', email: 'free@test.com', plan: 'FREE', trialEndsAt: null });
      expect(store.isPremium()).toBe(false);
    });

    it('retourne true pour plan PREMIUM', () => {
      mockAuth.currentUser.set({ id: '1', email: 'premium@test.com', plan: 'PREMIUM', trialEndsAt: null });
      expect(store.isPremium()).toBe(true);
    });

    it('retourne true si trial encore valide (dans 3 jours)', () => {
      const trialEndsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      mockAuth.currentUser.set({ id: '1', email: 'trial@test.com', plan: 'FREE', trialEndsAt });
      expect(store.isPremium()).toBe(true);
    });

    it('retourne false si trial expiré (il y a 1 jour)', () => {
      const trialEndsAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      mockAuth.currentUser.set({ id: '1', email: 'expired@test.com', plan: 'FREE', trialEndsAt });
      expect(store.isPremium()).toBe(false);
    });

    it('est réactif : se met à jour quand le user change', () => {
      mockAuth.currentUser.set({ id: '1', email: 'test@test.com', plan: 'FREE', trialEndsAt: null });
      expect(store.isPremium()).toBe(false);

      mockAuth.currentUser.set({ id: '1', email: 'test@test.com', plan: 'PREMIUM', trialEndsAt: null });
      expect(store.isPremium()).toBe(true);
    });
  });

  describe('displayName', () => {
    it('retourne le nom si disponible', () => {
      mockAuth.currentUser.set({ id: '1', email: 'test@test.com', name: 'Thomas', plan: 'FREE' });
      expect(store.displayName()).toBe('Thomas');
    });

    it('retourne l\'email si pas de nom', () => {
      mockAuth.currentUser.set({ id: '1', email: 'test@test.com', plan: 'FREE' });
      expect(store.displayName()).toBe('test@test.com');
    });
  });

  describe('initials', () => {
    it('retourne les 2 premières lettres du nom en majuscule', () => {
      mockAuth.currentUser.set({ id: '1', email: 'test@test.com', name: 'Thomas', plan: 'FREE' });
      expect(store.initials()).toBe('TH');
    });
  });
});
