import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { AuthService } from './auth.service';
import { AuthenticatedPreloading, whenIdle } from './authenticated-preloading';

describe('AuthenticatedPreloading', () => {
  const isAuthenticated = signal(false);
  const load = vi.fn(() => of('chunk'));

  beforeEach(() => {
    vi.useFakeTimers();
    isAuthenticated.set(false);
    load.mockClear();
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: { isAuthenticated } }] });
  });
  afterEach(() => vi.useRealTimers());

  it('visiteur anonyme (/register, /login) : aucune page préchargée', () => {
    const values: unknown[] = [];
    TestBed.inject(AuthenticatedPreloading).preload({}, load).subscribe((v) => values.push(v));
    vi.runAllTimers();
    expect(load).not.toHaveBeenCalled();
    expect(values).toEqual([null]);
  });

  it('connecté : préchargement une fois le navigateur inactif, jamais avant', () => {
    isAuthenticated.set(true);
    const values: unknown[] = [];
    TestBed.inject(AuthenticatedPreloading).preload({}, load).subscribe((v) => values.push(v));
    expect(load).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(load).toHaveBeenCalledOnce();
    expect(values).toEqual(['chunk']);
  });
});

describe('whenIdle', () => {
  it('utilise requestIdleCallback quand il existe, et l’annule au désabonnement', () => {
    const cancelIdleCallback = vi.fn();
    const win = { requestIdleCallback: vi.fn(() => 7), cancelIdleCallback } as unknown as Window;
    whenIdle(win).subscribe().unsubscribe();
    expect(win.requestIdleCallback).toHaveBeenCalledOnce();
    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
  });
});
