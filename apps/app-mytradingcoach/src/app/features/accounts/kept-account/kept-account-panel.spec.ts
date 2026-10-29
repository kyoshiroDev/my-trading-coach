import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { KeptAccountPanelComponent } from './kept-account-panel.component';
import { SelectedAccountStore } from '@app/core/stores/selected-account.store';
import { AccountsApi, type TradingAccount } from '@app/core/api/accounts.api';
import { ToastService } from '@app/core/services/toast.service';
import TEMPLATE from './kept-account-panel.component.html?raw';

/** Choix du compte gardé en gratuit (#769) : VRAI template, API et store simulés. */

const acc = (id: string, over: Partial<TradingAccount> = {}): TradingAccount =>
  ({ id, label: `Compte ${id}`, status: 'ACTIVE', overFreeLimit: false, ...over }) as TradingAccount;

const api = { keep: vi.fn() };
const toast = { success: vi.fn(), error: vi.fn() };
const load = vi.fn();

function mount(accounts: TradingAccount[]) {
  TestBed.configureTestingModule({
    providers: [
      { provide: SelectedAccountStore, useValue: { accounts: signal(accounts), load } },
      { provide: AccountsApi, useValue: api },
      { provide: ToastService, useValue: toast },
    ],
  });
  TestBed.overrideComponent(KeptAccountPanelComponent, {
    set: { template: TEMPLATE, styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(KeptAccountPanelComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  return { fixture, el, q };
}

describe('Panneau « compte gardé » (#769)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.keep.mockReturnValue(of({ data: { keptAccountId: 'b' } }));
  });

  it('caché sans compte en trop (Premium, un seul compte)', () => {
    const { q } = mount([acc('a'), acc('b'), acc('old', { status: 'ARCHIVED' })]);
    expect(q('kept-account-panel')).toBeNull();
  });

  it('comptes en trop : comptes actifs seulement, le compte gardé présélectionné, bouton inactif', () => {
    const { q, el } = mount([acc('a'), acc('b', { overFreeLimit: true }), acc('old', { status: 'ARCHIVED' })]);
    expect(q('kept-account-panel')).not.toBeNull();
    expect(q('kept-option-old')).toBeNull();
    expect(q('kept-option-a')?.querySelector('input')?.checked).toBe(true);
    expect((q('kept-account-save') as HTMLButtonElement).disabled).toBe(true);
    expect(el.textContent).toContain('restent visibles');
  });

  it('choisir un autre compte → POST keep, rechargement de la liste', () => {
    const { q, fixture } = mount([acc('a'), acc('b', { overFreeLimit: true })]);
    q('kept-option-b')!.querySelector('input')!.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const save = q('kept-account-save') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    save.click();
    expect(api.keep).toHaveBeenCalledWith('b');
    expect(load).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenCalled();
  });

  it('échec : message d’erreur, pas de rechargement', () => {
    api.keep.mockReturnValue(throwError(() => new Error('500')));
    const { q, fixture } = mount([acc('a'), acc('b', { overFreeLimit: true })]);
    q('kept-option-b')!.querySelector('input')!.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    (q('kept-account-save') as HTMLButtonElement).click();
    expect(toast.error).toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });
});
