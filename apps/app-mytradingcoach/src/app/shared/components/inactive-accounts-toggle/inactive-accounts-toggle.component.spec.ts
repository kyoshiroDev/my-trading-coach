import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { InactiveAccountsToggleComponent } from './inactive-accounts-toggle.component';
import { SelectedAccountStore } from '@app/core/stores/selected-account.store';
import { AccountsApi, TradingAccount } from '@app/core/api/accounts.api';
import TEMPLATE from './inactive-accounts-toggle.component.html?raw';

/** Compte perdu, écran 5 : ligne des comptes exclus + interrupteur, avec le VRAI store. */

const acc = (id: string, status: TradingAccount['status']): TradingAccount => ({ id, label: id, status }) as TradingAccount;

function setup(accounts: TradingAccount[]) {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [{ provide: AccountsApi, useValue: { getAll: vi.fn(() => of({ data: accounts })) } }],
  });
  TestBed.overrideComponent(InactiveAccountsToggleComponent, {
    set: { template: TEMPLATE, imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const store = TestBed.inject(SelectedAccountStore);
  store.load();
  const fixture = TestBed.createComponent(InactiveAccountsToggleComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  return { fixture, el, q, store };
}

describe('InactiveAccountsToggleComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('« Tous les comptes » avec des comptes perdus : ligne de la maquette + interrupteur désactivé', () => {
    const { q, el } = setup([acc('a', 'ACTIVE'), acc('p', 'PASSED'), acc('f', 'FAILED'), acc('x', 'ARCHIVED')]);
    expect(q('excluded-accounts-line')!.textContent).toContain('2 comptes exclus des chiffres : 1 échoué, 1 archivé.');
    const sw = q('include-inactive-toggle') as HTMLInputElement;
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.checked).toBe(false);
    expect(el.textContent).toContain('Inclure les comptes échoués et archivés');
  });

  it('activer l\'interrupteur : le store réintègre tout, la ligne dit « Aucun compte exclu. »', () => {
    const { q, fixture, store } = setup([acc('a', 'ACTIVE'), acc('f', 'FAILED')]);
    const sw = q('include-inactive-toggle') as HTMLInputElement;
    sw.click();
    fixture.detectChanges();
    expect(store.includeInactive()).toBe(true);
    expect(store.statsParams()).toEqual({ includeInactive: 'true' });
    expect(q('excluded-accounts-line')!.textContent).toContain('Aucun compte exclu.');
  });

  it('aucun compte échoué ni archivé : rien d\'affiché', () => {
    const { q, fixture } = setup([acc('a', 'ACTIVE'), acc('p', 'PASSED')]);
    expect(q('excluded-accounts-line')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).classList.contains('is-empty')).toBe(true);
  });

  it('compte précis sélectionné (même échoué) : pas de ligne, ses chiffres s\'affichent tels quels', () => {
    const { q, fixture, store } = setup([acc('a', 'ACTIVE'), acc('f', 'FAILED')]);
    store.select('f');
    fixture.detectChanges();
    expect(q('excluded-accounts-line')).toBeNull();
    expect(store.statsParams()).toEqual({ accountId: 'f' });
  });

  it('tous les comptes échoués : la ligne les annonce tous', () => {
    const { q } = setup([acc('f1', 'FAILED'), acc('f2', 'FAILED')]);
    expect(q('excluded-accounts-line')!.textContent).toContain('2 comptes exclus des chiffres : 2 échoués.');
  });
});
