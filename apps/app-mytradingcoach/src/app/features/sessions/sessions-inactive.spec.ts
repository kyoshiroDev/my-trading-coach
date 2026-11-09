/**
 * Historique des sessions — compte perdu : séances des comptes échoués et archivés masquées en
 * « Tous les comptes » (l'API filtre), l'interrupteur partagé les réinclut (`includeInactive`).
 * VRAI template ; le sélecteur de compte est neutralisé (NO_ERRORS_SCHEMA).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { SessionsComponent } from './sessions.component';
import { SessionApi } from '../../core/api/session.api';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { UserStore } from '../../core/stores/user.store';
import { statsScopeStub } from '../../core/stores/selected-account.store.stub';
import { InactiveAccountsToggleComponent } from '../../shared/components/inactive-accounts-toggle/inactive-accounts-toggle.component';
import { PnlFormatPipe } from '../../shared/pipes/pnl-format.pipe';
import { EmotionEmojiPipe } from '../../shared/pipes/emotion-emoji.pipe';
import TEMPLATE from './sessions.component.html?raw';
import TOGGLE_HTML from '../../shared/components/inactive-accounts-toggle/inactive-accounts-toggle.component.html?raw';

function setup(accounts: { status: string }[]) {
  const api = { getSessionsByMonth: vi.fn(() => of({ data: [] })) };
  const store = {
    ...statsScopeStub(),
    accounts: signal(accounts),
    accountParam: () => undefined,
    loaded: signal(true), isLoading: signal(false), load: vi.fn(),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: SessionApi, useValue: api },
      { provide: SelectedAccountStore, useValue: store },
      { provide: UserStore, useValue: { isPremium: () => true, isDemo: () => false, user: () => ({}) } },
    ],
  });
  TestBed.overrideComponent(SessionsComponent, {
    set: {
      template: TEMPLATE,
      imports: [DatePipe, DecimalPipe, PnlFormatPipe, EmotionEmojiPipe, InactiveAccountsToggleComponent],
      styleUrls: [], styleUrl: undefined as unknown as string,
      schemas: [NO_ERRORS_SCHEMA],
    },
  });
  TestBed.overrideComponent(InactiveAccountsToggleComponent, {
    set: { template: TOGGLE_HTML, styleUrls: [], styleUrl: undefined as unknown as string },
  });
  const fixture = TestBed.createComponent(SessionsComponent);
  fixture.detectChanges();
  const lastIncludeInactive = () => (api.getSessionsByMonth.mock.calls.at(-1) as unknown[])[4];
  return { fixture, api, store, el: fixture.nativeElement as HTMLElement, lastIncludeInactive };
}

describe('Historique des sessions — comptes échoués et archivés', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T10:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('par défaut sans includeInactive ; l\'interrupteur recharge avec, puis sans', () => {
    const { fixture, store, api, lastIncludeInactive } = setup([{ status: 'ACTIVE' }, { status: 'ARCHIVED' }]);
    expect(api.getSessionsByMonth).toHaveBeenCalledWith(2026, 11, undefined, 50, false);
    store.includeInactive.set(true);
    fixture.detectChanges();
    expect(lastIncludeInactive()).toBe(true);
    store.includeInactive.set(false);
    fixture.detectChanges();
    expect(lastIncludeInactive()).toBe(false);
  });

  it('interrupteur affiché avec la ligne des comptes exclus quand un compte est archivé', () => {
    const { el } = setup([{ status: 'ACTIVE' }, { status: 'ARCHIVED' }]);
    const toggle = el.querySelector('mtc-inactive-accounts-toggle')!;
    expect(toggle.classList).not.toContain('is-empty');
    expect(toggle.textContent).toContain('1 compte exclu des chiffres : 1 archivé.');
    expect(toggle.querySelector('input[role="switch"]')).not.toBeNull();
  });

  it('aucun compte échoué ni archivé : interrupteur masqué', () => {
    const { el } = setup([{ status: 'ACTIVE' }]);
    expect(el.querySelector('mtc-inactive-accounts-toggle')!.classList).toContain('is-empty');
  });

  it('compte archivé entre-temps : la liste se recharge', () => {
    const { fixture, store, api } = setup([{ status: 'ACTIVE' }, { status: 'ACTIVE' }]);
    const before = api.getSessionsByMonth.mock.calls.length;
    store.accounts.set([{ status: 'ACTIVE' }, { status: 'ARCHIVED' }]);
    fixture.detectChanges();
    expect(api.getSessionsByMonth.mock.calls.length).toBe(before + 1);
  });
});
