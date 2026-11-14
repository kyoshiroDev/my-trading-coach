/**
 * Audit fonctionnel #994 (lot 1d #998) — Séance du jour.
 * F9  : journal tapé puis page quittée dans la seconde : la sauvegarde différée (1,2 s) était annulée.
 * F16 : séance close rechargée, choisir « Neutre » ou vider le journal : l'effet de pré-remplissage
 *       remettait aussitôt l'ancienne humeur / les anciennes notes (le serveur avait reçu le choix).
 * F25 : « Démarrer » et « Clôturer » changeaient d'onglet même quand l'appel échouait.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { TodaySessionComponent } from './today-session.component';
import { SessionStore } from '../../core/stores/session.store';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { UserStore } from '../../core/stores/user.store';
import { LiveModeService } from '../../core/services/live-mode.service';
import { SessionApi, type TradingSession } from '../../core/api/session.api';
import { ToastService } from '../../core/services/toast.service';

function mount(initial: Partial<TradingSession> | null) {
  const activeSession = signal<TradingSession | null>(initial as TradingSession | null);
  const store = {
    activeSession, todayTrades: signal([]), todayStats: signal(null), currentObjectives: signal([]),
    loadSessionData: vi.fn(), startSession: vi.fn(), closeSessionThenDebrief: vi.fn(),
  };
  const updateSession = vi.fn(() => of({ data: {} }));
  TestBed.configureTestingModule({
    providers: [
      { provide: SessionStore, useValue: store },
      { provide: SelectedAccountStore, useValue: { activeAccounts: signal([{ id: 'a' }]), accountParam: () => 'a', load: vi.fn() } },
      { provide: UserStore, useValue: { isPremium: () => false, isDemo: () => false, user: () => ({}) } },
      { provide: LiveModeService, useValue: { activate: vi.fn(), deactivate: vi.fn() } },
      { provide: SessionApi, useValue: { updateSession } },
      { provide: ToastService, useValue: { error: vi.fn(), success: vi.fn() } },
    ],
  });
  TestBed.overrideComponent(TodaySessionComponent, {
    set: { template: '<div></div>', imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(TodaySessionComponent);
  fixture.detectChanges();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { fixture, cmp: fixture.componentInstance as any, store, updateSession, activeSession };
}

beforeEach(() => TestBed.resetTestingModule());

describe('Séance du jour — journal et humeur de fin', () => {
  it('F9 : page quittée avant la sauvegarde différée → le texte part quand même', () => {
    vi.useFakeTimers();
    const { fixture, cmp, updateSession } = mount({ id: 's1', status: 'ACTIVE' });
    cmp.onJournalInput('fin de séance');
    fixture.destroy();
    expect(updateSession).toHaveBeenCalledWith('s1', { notes: 'fin de séance' });
    vi.useRealTimers();
  });

  it('F9 : sauvegarde déjà partie, puis page quittée → pas de second envoi identique', () => {
    vi.useFakeTimers();
    const { fixture, cmp, updateSession } = mount({ id: 's1', status: 'ACTIVE' });
    cmp.onJournalInput('fin de séance');
    vi.advanceTimersByTime(1200);
    fixture.destroy();
    expect(updateSession).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
