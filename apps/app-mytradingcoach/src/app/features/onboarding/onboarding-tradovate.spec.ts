import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { OnboardingComponent } from './onboarding.component';
import { UsersApi } from '../../core/api/users.api';
import { TradesApi } from '../../core/api/trades.api';
import { TradesStore } from '../../core/stores/trades.store';
import { AuthService } from '../../core/auth/auth.service';
import { SetupsStore } from '../../core/stores/setups.store';
import { AccountsApi } from '../../core/api/accounts.api';
import { TradovateStore } from '../../core/stores/tradovate.store';
import type { TradovateConnection, TradovateSyncResult } from '../../core/api/tradovate.api';
import TEMPLATE from './onboarding.component.html?raw';

/**
 * PROMPT-208 — carte Tradovate à l'étape 8 et RETOUR après OAuth (écran 2bis).
 * VRAI template (import `?raw`) ; seuls les composants enfants et les icônes sont
 * neutralisés (NO_ERRORS_SCHEMA), comme dans les autres specs de ce composant.
 */
const PROGRESS_KEY = 'mtc.onboarding.progress';

const accountsApi = { getAll: vi.fn(), create: vi.fn() };
const tradesStore = { loadTrades: vi.fn(), reset: vi.fn(), addTrade: vi.fn() };
const router = { navigate: vi.fn() };
const connections = signal<TradovateConnection[]>([]);
const tvStore = {
  connections,
  byAccount: computed(() => new Map(connections().map((c) => [c.accountId, c] as const))),
  busy: signal<Record<string, string | undefined>>({}),
  feedback: signal<Record<string, { lines: []; error: string | null } | undefined>>({}),
  load: vi.fn(), authorizeUrl: vi.fn(), selectThenSync: vi.fn(),
};
const authUser = signal<unknown>(null);

function saveProgress(step: number): void {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify({
    step, market: 'MULTI', goal: 'DISCIPLINE', currency: 'USD', capital: '50000',
    accountMode: 'PROPFIRM', broker: 'Apex', profitTarget: '3000', maxDrawdown: '2500',
    drawdownType: 'TRAILING', style: null, strategy: '', sessions: [], assets: [], favorite: null,
  }));
}

function mount() {
  TestBed.configureTestingModule({
    providers: [
      { provide: UsersApi, useValue: { saveOnboardingProfile: vi.fn(), finishOnboarding: vi.fn() } },
      { provide: TradesApi, useValue: { create: vi.fn(), saveUserAssets: vi.fn(), searchInstruments: vi.fn() } },
      { provide: TradesStore, useValue: tradesStore },
      { provide: SetupsStore, useValue: { load: vi.fn(), active: () => [], create: vi.fn(), remove: vi.fn() } },
      { provide: AccountsApi, useValue: accountsApi },
      { provide: AuthService, useValue: { currentUser: authUser, setCurrentUser: vi.fn() } },
      { provide: TradovateStore, useValue: tvStore },
      { provide: Router, useValue: router },
    ],
  });
  TestBed.overrideComponent(OnboardingComponent, {
    set: {
      template: TEMPLATE, imports: [],
      styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const fixture = TestBed.createComponent(OnboardingComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const cmp = fixture.componentInstance as unknown as {
    step: () => number;
    onTradovatePicked: (id: string) => void;
  };
  return { fixture, el, q, cmp };
}

function returnUrl(query: string): void {
  window.history.replaceState(null, '', `/dashboard?${query}`);
}

describe('Onboarding — étape 8 : carte « Connecter mon compte Tradovate »', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
    localStorage.clear();
    window.history.replaceState(null, '', '/dashboard');
    connections.set([]);
    saveProgress(8);
  });

  it('4 cartes : CSV conservé, Tradovate ajoutée juste après, manuel et zéro intacts', () => {
    const { el, q } = mount();
    const ids = [...el.querySelectorAll('.choice-grid-4 [data-testid]')].map((n) => n.getAttribute('data-testid'));
    expect(ids).toEqual([
      'onboarding-choice-csv',
      'onboarding-choice-tradovate',
      'onboarding-choice-manual',
      'onboarding-choice-skip',
    ]);
    const card = q('onboarding-choice-tradovate')!.textContent!.replace(/\s+/g, ' ');
    expect(card).toContain('Le plus complet');
    expect(card).toContain('Connecter mon compte Tradovate');
    expect(card).toContain('tes trades arrivent tout seuls');
  });

  it('clic : réutilise le compte déjà créé et ouvre la réassurance (origine wizard), sans rediriger', () => {
    accountsApi.getAll.mockReturnValue(of({ data: [{ id: 'acc-1', label: 'Apex #1', status: 'ACTIVE' }] }));
    const { el, q, fixture } = mount();
    q('onboarding-choice-tradovate')!.click();
    fixture.detectChanges();
    expect(accountsApi.create).not.toHaveBeenCalled();
    const modal = el.querySelector('mtc-tradovate-connect-modal');
    expect(modal).not.toBeNull();
    expect(modal!.getAttribute('origin')).toBe('wizard');
    expect(tvStore.authorizeUrl).not.toHaveBeenCalled();
  });

  it('pas encore de compte (checkpoint raté) : le crée avec la déclaration de l’étape 3, puis réassurance', () => {
    accountsApi.getAll.mockReturnValue(of({ data: [] }));
    accountsApi.create.mockReturnValue(of({ data: { id: 'acc-new', label: 'Apex #1' } }));
    const { el, q, fixture } = mount();
    q('onboarding-choice-tradovate')!.click();
    fixture.detectChanges();
    expect(accountsApi.create).toHaveBeenCalledWith(expect.objectContaining({
      label: 'Apex #1', type: 'EVALUATION', broker: 'Apex', profitTarget: 3000, maxDrawdown: 2500,
    }));
    expect(el.querySelector('mtc-tradovate-connect-modal')).not.toBeNull();
  });

  it('préparation impossible : message non bloquant, les 4 options restent là', () => {
    accountsApi.getAll.mockReturnValue(throwError(() => ({ error: { message: 'Réseau indisponible.' } })));
    const { el, q, fixture } = mount();
    q('onboarding-choice-tradovate')!.click();
    fixture.detectChanges();
    expect(q('onboarding-tradovate-error')!.textContent).toContain('Réseau indisponible.');
    expect(q('onboarding-tradovate-error')!.textContent).toContain('importer un CSV');
    expect(el.querySelector('mtc-tradovate-connect-modal')).toBeNull();
    expect(q('onboarding-choice-csv')).not.toBeNull();
  });
});

describe('Onboarding — retour après OAuth Tradovate (écran 2bis)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
    localStorage.clear();
    connections.set([]);
  });
  afterEach(() => window.history.replaceState(null, '', '/dashboard'));

  it('succès : écran final avec le récap (même style que le CSV), URL nettoyée, journal rechargé', () => {
    saveProgress(8);
    returnUrl('tradovate=connected&accountId=acc-1&trades=34&fees=ok&from=wizard');
    const { q, cmp } = mount();
    expect(cmp.step()).toBe(9);
    const recap = q('onboarding-tradovate-recap')!;
    expect(recap.classList).toContain('ob-import-recap');
    expect(recap.textContent).toContain('Compte Tradovate connecté · 34 trades synchronisés');
    expect(tradesStore.reset).toHaveBeenCalled();
    const [commands, extras] = router.navigate.mock.calls[0];
    expect(commands).toEqual([]);
    expect(extras).toMatchObject({ replaceUrl: true, queryParamsHandling: 'merge' });
    expect(extras.queryParams).toMatchObject({ tradovate: null, from: null, trades: null });
  });

  it('JAMAIS renvoyé au début : même progression locale perdue, on atterrit sur l’écran final', () => {
    returnUrl('tradovate=connected&accountId=acc-1&trades=0&from=wizard');
    const { q, cmp } = mount();
    expect(cmp.step()).toBe(9);
    expect(q('onboarding-tradovate-recap')!.textContent).toContain('Aucun nouveau trade');
  });

  it('première synchro en échec : connecté, avertissement pour relancer depuis Mes comptes', () => {
    saveProgress(8);
    returnUrl('tradovate=connected&accountId=acc-1&sync=error&from=wizard');
    const { q } = mount();
    expect(q('onboarding-tradovate-recap')!.textContent).toContain('relance-la depuis Mes comptes');
  });

  it('échec : retour à l’étape 8, message clair et non bloquant, options intactes', () => {
    saveProgress(8);
    returnUrl('tradovate=error&reason=denied&accountId=acc-1&from=wizard');
    const { q, cmp } = mount();
    expect(cmp.step()).toBe(8);
    const msg = q('onboarding-tradovate-error')!.textContent!;
    expect(msg).toContain("Tu as refusé l'accès");
    expect(msg).toContain('importer un CSV');
    expect(q('onboarding-choice-tradovate')).not.toBeNull();
    expect(q('onboarding-choice-csv')).not.toBeNull();
    expect(router.navigate).toHaveBeenCalled();
  });

  it('plusieurs comptes Tradovate : choix à l’étape 8, puis synchro et écran final', () => {
    saveProgress(8);
    returnUrl('tradovate=select_account&accountId=acc-1&from=wizard');
    const { q, cmp, el, fixture } = mount();
    expect(cmp.step()).toBe(8);
    expect(tvStore.load).toHaveBeenCalled();
    expect(q('onboarding-tradovate-pick')).not.toBeNull();

    connections.set([{
      accountId: 'acc-1', status: 'CONNECTED', externalAccountId: null, externalAccountName: null,
      externalEnv: null, needsAccountSelection: true, lastSyncAt: null, lastSyncError: null,
      tradesImported: 0, connectedAt: '2026-09-12T00:00:00Z',
      availableAccounts: [{ id: '1', name: 'LIVE-1', env: 'live' }, { id: '2', name: 'DEMO-2', env: 'demo' }],
    }]);
    fixture.detectChanges();
    expect(el.querySelector('mtc-tradovate-account-picker')).not.toBeNull();

    cmp.onTradovatePicked('2');
    expect(tvStore.selectThenSync).toHaveBeenCalledWith('acc-1', '2', expect.any(Function));
    const done = tvStore.selectThenSync.mock.calls[0][2] as (r: TradovateSyncResult | null) => void;
    done({
      created: 12, duplicates: 0, failed: 0, total: 12, skipped: 0, openPositions: 0,
      feesImported: { assigned: 5, expected: 5, reconciled: true, count: 12 }, lastSyncAt: '2026-09-12T00:00:00Z',
    });
    fixture.detectChanges();
    expect(cmp.step()).toBe(9);
    expect(q('onboarding-tradovate-recap')!.textContent).toContain('12 trades synchronisés');
  });

  it('retour destiné aux réglages : ignoré par le wizard (progression intacte, URL non touchée)', () => {
    saveProgress(6);
    returnUrl('tradovate=connected&accountId=acc-1&trades=3');
    const { cmp } = mount();
    expect(cmp.step()).toBe(6);
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
