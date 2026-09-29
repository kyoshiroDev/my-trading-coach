/**
 * pour Tradovate, la synchro API est l'option PRINCIPALE, le CSV un repli.
 *
 * Verrouille la LOGIQUE (le placement dans le template est couvert par
 * csv-import-tradovate-order.spec.ts) :
 *  1. Tradovate hors onboarding → recommandation « connecter », pas de dépôt de fichier ;
 *  2. « Autre broker » et onboarding (allowFeesFile=false) → inchangés, jamais de reco ;
 *  3. le repli CSV reste accessible, et chaque ouverture repart sur la reco ;
 *  4. la connexion vise le compte choisi ; un compte déjà connecté se synchronise directement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { CsvImportComponent } from './csv-import.component';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { SetupsStore } from '../../core/stores/setups.store';
import { TradovateStore } from '../../core/stores/tradovate.store';
import type { TradovateConnection, TradovateSyncResult } from '../../core/api/tradovate.api';

const ACCOUNTS = [
  { id: 'acc-apex', label: 'Apex 50K', status: 'ACTIVE' },
  { id: 'acc-lucid', label: 'Lucid 25K', status: 'ACTIVE' },
];

function conn(accountId: string, over: Partial<TradovateConnection> = {}): TradovateConnection {
  return {
    accountId, status: 'CONNECTED', needsAccountSelection: false,
    ...over,
  } as TradovateConnection;
}

function mount(opts: { allowFeesFile?: boolean; connections?: TradovateConnection[] } = {}) {
  const connections = signal<TradovateConnection[]>(opts.connections ?? []);
  const tv = {
    byAccount: signal(new Map(connections().map((c) => [c.accountId, c] as const))),
    busy: signal<Record<string, string | undefined>>({}),
    load: vi.fn(),
    sync: vi.fn(),
  };
  const accountLoad = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: TradovateStore, useValue: tv },
      { provide: SetupsStore, useValue: { active: signal([]), load: vi.fn(), loaded: signal(true) } },
      {
        provide: SelectedAccountStore,
        useValue: {
          activeAccounts: signal(ACCOUNTS), selectedAccountId: signal('acc-apex'),
          load: accountLoad, loaded: signal(true),
        },
      },
    ],
  });
  TestBed.overrideComponent(CsvImportComponent, {
    set: {
      template: '<div></div>', imports: [], styleUrls: [],
      styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const fixture = TestBed.createComponent(CsvImportComponent);
  const cmp = fixture.componentInstance as any;
  // Signal inputs non modifiables en JIT : on les remplace sur l'instance.
  const open = signal(false);
  cmp.open = open;
  cmp.allowFeesFile = signal(opts.allowFeesFile ?? true);
  fixture.detectChanges();
  const reopen = () => {
    open.set(false);
    fixture.detectChanges();
    open.set(true);
    fixture.detectChanges();
  };
  return { cmp, tv, fixture, open, reopen, accountLoad };
}

describe('Import — Tradovate : la synchro d’abord, le CSV en repli', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('Tradovate (hors onboarding) → recommandation de connexion, pas de dépôt de fichier', () => {
    const { cmp } = mount();
    cmp.source.set('tradovate');
    expect(cmp.tvReco()).toBe(true);
  });

  it('« Autre broker » → aucune reco, parcours fichier inchangé', () => {
    const { cmp } = mount();
    cmp.source.set('other');
    expect(cmp.tvReco()).toBe(false);
  });

  it('onboarding (allowFeesFile=false) → jamais de reco : le wizard garde son import simple', () => {
    const { cmp } = mount({ allowFeesFile: false });
    cmp.source.set('tradovate');
    expect(cmp.tvReco()).toBe(false);
  });

  it('« ou importer un fichier CSV » déroule le dépôt ; « plutôt connecter » y revient', () => {
    const { cmp } = mount();
    cmp.source.set('tradovate');
    cmp.tvCsvOpen.set(true);
    expect(cmp.tvReco()).toBe(false);
    cmp.tvCsvOpen.set(false);
    expect(cmp.tvReco()).toBe(true);
  });

  it('chaque ouverture repart sur la reco et recharge l’état des connexions', () => {
    const { cmp, tv, reopen } = mount();
    cmp.tvCsvOpen.set(true);
    reopen();
    expect(cmp.tvCsvOpen()).toBe(false);
    expect(tv.load).toHaveBeenCalled();
  });

  it('en onboarding, l’ouverture ne sollicite pas l’API Tradovate', () => {
    const { tv, reopen } = mount({ allowFeesFile: false });
    reopen();
    expect(tv.load).not.toHaveBeenCalled();
  });

  it('« Connecter » ouvre la réassurance pour le compte CHOISI', () => {
    const { cmp } = mount();
    cmp.accountId.set('acc-lucid');
    expect(cmp.tvState()).toBe('connect');
    cmp.openTradovateConnect();
    expect(cmp.tvConnectTarget()).toEqual({ id: 'acc-lucid', label: 'Lucid 25K' });
  });

  it('sans compte choisi : pas de cible, le bouton reste inactif', () => {
    const { cmp } = mount();
    cmp.accountId.set('');
    expect(cmp.tvTarget()).toBeNull();
    cmp.openTradovateConnect();
    expect(cmp.tvConnectTarget()).toBeNull();
  });

  it('états : connecté → sync · jeton expiré → reconnect · choix du compte Tradovate en attente → finish', () => {
    const { cmp } = mount({
      connections: [conn('acc-apex'), conn('acc-lucid', { status: 'NEEDS_RECONNECT' })],
    });
    cmp.accountId.set('acc-apex');
    expect(cmp.tvState()).toBe('sync');
    cmp.accountId.set('acc-lucid');
    expect(cmp.tvState()).toBe('reconnect');
  });

  it('choix du compte Tradovate en attente → finish', () => {
    const { cmp } = mount({ connections: [conn('acc-apex', { needsAccountSelection: true })] });
    cmp.accountId.set('acc-apex');
    expect(cmp.tvState()).toBe('finish');
  });

  it('compte déjà connecté : synchro directe, le résultat suit le chemin d’un import', () => {
    const { cmp, tv, accountLoad } = mount({ connections: [conn('acc-apex')] });
    cmp.accountId.set('acc-apex');
    const emitted: unknown[] = [];
    cmp.imported.subscribe((r: unknown) => emitted.push(r));
    cmp.syncTradovate();
    expect(tv.sync).toHaveBeenCalledWith('acc-apex', expect.any(Function));
    const done = tv.sync.mock.calls[0][1] as (r: TradovateSyncResult | null) => void;
    const fees = { assigned: 3, expected: 3, reconciled: true, count: 3 };
    done({ created: 3, duplicates: 1, failed: 0, total: 4, feesImported: fees } as TradovateSyncResult);
    expect(accountLoad).toHaveBeenCalled();
    expect(emitted).toEqual([{ created: 3, duplicates: 1, failed: 0, total: 4, feesImported: fees }]);
  });

  it('synchro en échec : rien n’est émis (le store a déjà affiché le toast d’erreur)', () => {
    const { cmp, tv } = mount({ connections: [conn('acc-apex')] });
    cmp.accountId.set('acc-apex');
    const emitted: unknown[] = [];
    cmp.imported.subscribe((r: unknown) => emitted.push(r));
    cmp.syncTradovate();
    (tv.sync.mock.calls[0][1] as (r: null) => void)(null);
    expect(emitted).toEqual([]);
  });
});
