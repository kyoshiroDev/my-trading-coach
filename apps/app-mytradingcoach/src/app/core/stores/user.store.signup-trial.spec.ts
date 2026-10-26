import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { UserStore, calendarDaysUntil } from './user.store';
import { AuthService, AuthUser } from '../auth/auth.service';

// Essai d'inscription (#769) : jours restants (bandeau), fin d'essai (fenêtre), et le Premium offert
// par l'admin qui ne doit plus englober l'essai d'inscription.

const DAY = 86_400_000;
const NOW = new Date('2026-11-10T12:00:00.000Z');
const inDays = (d: number) => new Date(NOW.getTime() + d * DAY).toISOString();

describe('UserStore : essai d’inscription (#769)', () => {
  const currentUser = signal<AuthUser | null>(null);
  let store: UserStore;
  const set = (over: Partial<AuthUser>) =>
    currentUser.set({ id: 'u1', email: 'a@b.c', plan: 'FREE', trialEndsAt: null, ...over });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    currentUser.set(null);
    TestBed.configureTestingModule({
      providers: [UserStore, { provide: AuthService, useValue: { currentUser, isAuthenticated: signal(true), fetchMe: vi.fn() } }],
    });
    store = TestBed.inject(UserStore);
  });
  afterEach(() => vi.useRealTimers());

  it('jours de calendrier jusqu’au jour de fin : 0 le jour de fin, 1 la veille', () => {
    const at = (d: number, h: number) => {
      const x = new Date(NOW);
      x.setDate(x.getDate() + d);
      x.setHours(h, 0, 0, 0);
      return x;
    };
    expect(calendarDaysUntil(at(0, 23), at(0, 1))).toBe(0); // fin plus tard aujourd'hui
    expect(calendarDaysUntil(at(1, 0), at(0, 23))).toBe(1); // fin demain, même dans 1 h
    expect(calendarDaysUntil(at(1, 23), at(0, 1))).toBe(1);
    expect(calendarDaysUntil(at(9, 3), at(0, 15))).toBe(9);
    set({ trialSource: 'SIGNUP', trialEndsAt: at(0, 23).toISOString(), signupTrialEndsAt: at(0, 23).toISOString() });
    vi.setSystemTime(at(0, 8));
    expect(store.signupTrialDaysLeft()).toBe(0);
    expect(store.isPremium()).toBe(true);
  });

  it('pas de jours restants : Premium offert par l’admin, abonné Stripe, démo, essai fini', () => {
    set({ trialSource: 'ADMIN', trialEndsAt: inDays(5) });
    expect(store.signupTrialDaysLeft()).toBeNull();
    set({ trialSource: 'SIGNUP', trialEndsAt: inDays(5), stripeSubscriptionStatus: 'active' });
    expect(store.signupTrialDaysLeft()).toBeNull();
    set({ trialSource: 'SIGNUP', trialEndsAt: inDays(5), isDemo: true });
    expect(store.signupTrialDaysLeft()).toBeNull();
    set({ trialSource: 'SIGNUP', trialEndsAt: inDays(-1) });
    expect(store.signupTrialDaysLeft()).toBeNull();
  });

  it('Premium offert par l’admin : jamais l’essai d’inscription', () => {
    set({ trialSource: 'SIGNUP', trialEndsAt: inDays(5) });
    expect(store.isOfferedPremium()).toBe(false);
    set({ trialSource: 'ADMIN', trialEndsAt: inDays(5) });
    expect(store.isOfferedPremium()).toBe(true);
    set({ trialSource: null, trialEndsAt: inDays(5) }); // offert avant #769
    expect(store.isOfferedPremium()).toBe(true);
  });

  it('fin d’essai : seulement essai d’inscription fini, sans autre accès Premium, hors démo', () => {
    set({ trialSource: 'SIGNUP', trialEndsAt: inDays(-1), signupTrialEndsAt: inDays(-1) });
    expect(store.signupTrialEnded()).toBe(true);
    set({ trialSource: 'SIGNUP', trialEndsAt: inDays(2), signupTrialEndsAt: inDays(2) });
    expect(store.signupTrialEnded()).toBe(false);
    set({ trialSource: 'SIGNUP', trialEndsAt: inDays(-1), signupTrialEndsAt: inDays(-1), plan: 'PREMIUM' });
    expect(store.signupTrialEnded()).toBe(false);
    set({ trialSource: 'ADMIN', trialEndsAt: inDays(10), signupTrialEndsAt: inDays(-1) });
    expect(store.signupTrialEnded()).toBe(false);
    set({ trialSource: 'SIGNUP', trialEndsAt: inDays(-1), signupTrialEndsAt: inDays(-1), isDemo: true });
    expect(store.signupTrialEnded()).toBe(false);
  });
});
