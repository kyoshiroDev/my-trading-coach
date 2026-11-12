/**
 * Historique des sessions — devises mêlées (#947) : en « Tous les comptes » avec un compte USD et
 * un compte EUR, pas de total du mois ni de la semaine additionné ; chaque séance dans la devise de
 * SON compte. VRAI template.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { DatePipe, DecimalPipe, registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { PctPipe } from '@mtc/front-ui';
import { SessionsComponent } from './sessions.component';
import { SessionApi } from '../../core/api/session.api';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { UserStore } from '../../core/stores/user.store';
import { statsScopeStub } from '../../core/stores/selected-account.store.stub';
import { PnlFormatPipe } from '../../shared/pipes/pnl-format.pipe';
import { EmotionEmojiPipe } from '../../shared/pipes/emotion-emoji.pipe';
import TEMPLATE from './sessions.component.html?raw';

registerLocaleData(localeFr, 'fr-FR');

const item = (id: string, accountId: string, totalPnl: number) => ({
  id, accountId, startedAt: '2026-11-09T09:00:00.000Z', endedAt: '2026-11-09T11:00:00.000Z',
  totalPnl, totalTrades: 1, winRate: 100, wins: 1, losses: 0, topAssets: ['NQ'], aiOneLiner: null,
});

function setup() {
  const accounts = [
    { id: 'usd', status: 'ACTIVE', currency: 'USD' },
    { id: 'eur', status: 'ACTIVE', currency: 'EUR' },
  ];
  const store = {
    ...statsScopeStub(),
    accounts: signal(accounts),
    accountParam: () => undefined,
    displayCurrency: signal<string | null>(null),
    currencyOf: (id: string) => accounts.find((a) => a.id === id)?.currency,
    loaded: signal(true), isLoading: signal(false), load: vi.fn(),
  };
  const api = { getSessionsByMonth: vi.fn(() => of({ data: [item('s1', 'usd', 100), item('s2', 'eur', 50)] })) };
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
      imports: [DatePipe, DecimalPipe, PnlFormatPipe, EmotionEmojiPipe, PctPipe],
      styleUrls: [], styleUrl: undefined as unknown as string,
      schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const fixture = TestBed.createComponent(SessionsComponent);
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement };
}

describe('Historique des sessions — devises mêlées (#947)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T10:00:00.000Z'));
  });

  it('pas de P&L du mois ni de la semaine additionné, avertissement', () => {
    const { el } = setup();
    expect(el.querySelector('.month-summary .ms-val')!.textContent!.trim()).toBe('—');
    expect(el.querySelector('.week-pnl')!.textContent!.trim()).toBe('—');
    expect(el.querySelector('mtc-mixed-currency-notice')).not.toBeNull();
  });

  it('chaque séance dans la devise de son compte', () => {
    const { el } = setup();
    const text = el.textContent!;
    expect(text).toContain('+$100');
    expect(text).toContain('+€50');
  });
});
