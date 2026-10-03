/**
 * un FREE au quota n'avait AUCUN chemin vers la modale Premium.
 *
 * Deux masquages indépendants fermaient le seul mécanisme d'upsell de la page :
 *
 *  1. `[showAddButton]="!atLimit()"` retirait le bouton du topbar une fois le quota
 *     atteint — alors que `openCreate()` sait déjà bifurquer vers la modale. La bonne
 *     logique existait, elle n'était simplement plus atteignable.
 *  2. La tuile « limite atteinte » vivait sous `selectedAccountId() === 'all'`. Or un
 *     FREE au quota n'a qu'UN compte : le sélecteur pointe forcément dessus, jamais sur
 *     « Tous les comptes ». La tuile ne s'affichait donc jamais pour celui qui en avait
 *     le plus besoin.
 *
 * Le trou de test : rien ne couvrait le chemin topbar → paywall. Ces tests vérifient les
 * deux entrées, y compris en vue « compte unique ».
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { AccountsComponent } from './accounts.component';
import { AccountsApi, TradingAccount } from '../../core/api/accounts.api';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { UserStore } from '../../core/stores/user.store';

function acct(id: string): TradingAccount {
  return {
    id, label: `Compte ${id}`, broker: null, type: 'PERSONAL', status: 'ACTIVE',
    accountSize: null, currency: 'USD', startingBalance: null,
    profitTarget: null, maxDrawdown: null, drawdownType: 'TRAILING', propFirmPlanId: null, platform: null, lastPayoutAt: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    metrics: {
      startingBalance: 5000, realizedPnl: 0, currentBalance: 5000, tradesCount: 0,
      winRate: null, bestDay: null, worstDay: null,
      objective: null, drawdown: null, drawdownUnconfirmed: false, progress: null, broker: null, estimated: true, disclaimer: 'estimé',
    },
  };
}

/**
 * Reproduit VERBATIM les deux points d'entrée du HTML réel. Le template complet monte
 * `mtc-topbar` (lucide), qui ne compile pas en JIT — d'où ce miroir, aligné à la main
 * sur `accounts.component.html`.
 */
const TEMPLATE = `
  <button data-testid="topbar-add" (click)="openCreate()">Ajouter un compte</button>

  @if (atLimit()) {
    <button data-testid="add-account-limit" (click)="showPlanModal.set(true)">
      Limite de {{ accountLimit() }} compte(s) atteinte
    </button>
  } @else if (store.selectedAccountId() === 'all') {
    <button data-testid="add-account-tile" (click)="openCreate()">Ajouter un compte</button>
  }

  @if (showPlanModal()) { <div data-testid="plan-modal"></div> }
`;

/** @param nbComptes comptes ACTIFS · @param limite quota du plan (null = illimité) */
function setup(nbComptes: number, limite: number | null, vue: string | 'all') {
  const store = {
    accounts: signal(Array.from({ length: nbComptes }, (_, i) => acct(`a${i}`))),
    selectedAccountId: signal<string | 'all'>(vue),
    isLoading: signal(false), loaded: signal(true), load: vi.fn(),
  };
  const userStore = { isDemo: () => false, isPremium: () => limite === null, maxAccounts: signal(limite) };

  TestBed.configureTestingModule({
    providers: [
      { provide: AccountsApi, useValue: { create: vi.fn(() => of({ data: {} })), getAll: vi.fn(() => of({ data: [] })) } },
      { provide: SelectedAccountStore, useValue: store },
      { provide: UserStore, useValue: userStore },
    ],
  });
  TestBed.overrideComponent(AccountsComponent, {
    set: {
      template: TEMPLATE, imports: [], styleUrls: [],
      styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const fixture = TestBed.createComponent(AccountsComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    cmp: fixture.componentInstance as any,
    q: (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null,
  };
}

describe('Comptes — le bouton du topbar mène au paywall au quota', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('FREE au quota : le bouton reste présent et ouvre la modale Premium', () => {
    const { q, cmp, fixture } = setup(1, 1, 'a0');

    const bouton = q('topbar-add');
    expect(bouton, 'Bouton retiré du DOM : plus aucun chemin vers l\'upsell').toBeTruthy();

    bouton!.click();
    fixture.detectChanges();

    expect(cmp.showPlanModal()).toBe(true);
    expect(q('plan-modal')).toBeTruthy();
  });

  it('sous le quota : le même bouton ouvre le formulaire, pas la modale', () => {
    const { q, cmp, fixture } = setup(1, null, 'all'); // Premium, illimité

    q('topbar-add')!.click();
    fixture.detectChanges();

    expect(cmp.showPlanModal()).toBe(false);
    expect(cmp.formOpen()).toBe(true);
  });
});

describe('Comptes — la tuile « limite atteinte » ne dépend plus de la vue', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('vue compte unique : la tuile est présente et ouvre la modale', () => {
    // LE cas du bug : un FREE au quota a un seul compte, donc le sélecteur pointe
    // dessus. La tuile vivait sous la vue « Tous les comptes », inatteignable pour lui.
    const { q, cmp, fixture } = setup(1, 1, 'a0');

    const tuile = q('add-account-limit');
    expect(tuile, 'Tuile absente en vue compte unique : invisible pour le seul concerné').toBeTruthy();

    tuile!.click();
    fixture.detectChanges();

    expect(cmp.showPlanModal()).toBe(true);
  });

  it('vue « Tous les comptes » : la tuile est là aussi (non-régression)', () => {
    const { q } = setup(1, 1, 'all');
    expect(q('add-account-limit')).toBeTruthy();
  });

  it('au quota, la tuile d\'AJOUT laisse la place à celle du quota', () => {
    const { q } = setup(1, 1, 'all');
    expect(q('add-account-tile'), 'Proposer d\'ajouter alors que c\'est refusé').toBeNull();
  });
});

describe('Comptes — la tuile d\'ajout reste réservée à la vue d\'ensemble', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('sous le quota, vue « Tous les comptes » → tuile d\'ajout visible', () => {
    const { q } = setup(2, null, 'all');
    expect(q('add-account-tile')).toBeTruthy();
  });

  it('sous le quota, vue filtrée → pas de tuile d\'ajout', () => {
    // Choix délibéré et documenté (e4eba29) : les actions de création sont masquées
    // dans une vue filtrée. Seule la tuile de QUOTA échappe à cette règle, parce
    // qu'elle est le seul chemin d'upsell.
    const { q } = setup(2, null, 'a0');
    expect(q('add-account-tile')).toBeNull();
  });
});
