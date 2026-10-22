import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { ConfirmService } from '@mtc/front-ui';
import { AccountPayoutsComponent, todayInput } from './account-payouts.component';
import { AccountsApi, type AccountPayout } from '@app/core/api/accounts.api';
import { ToastService } from '@app/core/services/toast.service';
import TEMPLATE from './account-payouts.component.html?raw';

const LIST: AccountPayout[] = [
  { id: 'm1', tradeDate: '2026-10-05', amount: 1_000, manual: true, confidence: 'certain' },
  { id: 'b1', tradeDate: '2026-09-01', amount: 700, manual: false, confidence: 'probable' },
];

function setup(opts: { connected?: boolean; list?: AccountPayout[]; confirm?: boolean } = {}) {
  const api = {
    listPayouts: vi.fn(() => of({ data: opts.list ?? LIST })),
    addPayout: vi.fn(() => of({ data: { id: 'm2', tradeDate: '2026-10-20', amount: 500, manual: true, confidence: 'certain' } })),
    removePayout: vi.fn(() => of({ data: { deleted: true } })),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: AccountsApi, useValue: api },
      { provide: ConfirmService, useValue: { ask: vi.fn(async () => opts.confirm ?? true) } },
    ],
  });
  TestBed.overrideComponent(AccountPayoutsComponent, {
    set: { template: TEMPLATE, imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(AccountPayoutsComponent);
  // JIT sous vitest : les `input()` ne se règlent pas par setInput, on remplace leurs signaux.
  const cmp = fixture.componentInstance as unknown as Record<string, unknown>;
  cmp['accountId'] = signal('a1');
  cmp['currency'] = signal('USD');
  cmp['connected'] = signal(opts.connected ?? false);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const changed = vi.fn();
  fixture.componentInstance.changed.subscribe(changed);
  return { fixture, el, q, api, changed, toast: TestBed.inject(ToastService) };
}

const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input'));
};

describe('AccountPayoutsComponent (payouts d\'un compte funded)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('au moins un payout : note discrète sur le plancher gelé, pas encore estimé', () => {
    const { q } = setup();
    expect(q('payouts-floor-lock-note')!.textContent!.trim())
      .toBe('Le plancher gelé après un payout n\'est pas encore pris en compte dans l\'estimation. Vérifie chez ta firm.');
    expect(q('payouts-floor-lock-note')!.className).toBe('ap-note');
  });

  it('aucun payout : pas de note sur le plancher gelé', () => {
    const { q } = setup({ list: [] });
    expect(q('payouts-empty')).not.toBeNull();
    expect(q('payouts-floor-lock-note')).toBeNull();
  });

  it('liste les payouts, saisis et détectés ; seul un payout saisi se supprime', () => {
    const { q } = setup();
    expect(q('payout-m1')!.textContent).toContain('05/10/2026');
    expect(q('payout-m1')!.textContent).toContain('saisi');
    expect(q('payout-b1')!.textContent).toContain('détecté (probable)');
    expect(q('payout-delete-m1')).not.toBeNull();
    expect(q('payout-delete-b1')).toBeNull();
  });

  it('compte sans connexion : formulaire ; ajout envoyé, puis liste rechargée et parent prévenu', () => {
    const { q, fixture, api, changed, toast } = setup();
    expect((q('payout-date') as HTMLInputElement).max).toBe(todayInput());
    type(q('payout-amount') as HTMLInputElement, '500');
    type(q('payout-date') as HTMLInputElement, '2026-10-20');
    fixture.detectChanges();
    q('payout-add')!.click();
    expect(api.addPayout).toHaveBeenCalledWith('a1', { tradeDate: '2026-10-20', amount: 500 });
    expect(api.listPayouts).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(toast.visible()[0].message).toContain('enregistré');
  });

  it('montant vide, nul ou date future : bouton désactivé', () => {
    const { q, fixture } = setup();
    const btn = () => q('payout-add') as HTMLButtonElement;
    expect(btn().disabled).toBe(true);
    type(q('payout-amount') as HTMLInputElement, '0');
    fixture.detectChanges();
    expect(btn().disabled).toBe(true);
    type(q('payout-amount') as HTMLInputElement, '300');
    type(q('payout-date') as HTMLInputElement, '2999-01-01');
    fixture.detectChanges();
    expect(btn().disabled).toBe(true);
  });

  it('compte connecté : pas de formulaire, message « détectés chez le broker »', () => {
    const { q } = setup({ connected: true });
    expect(q('payout-form')).toBeNull();
    expect(q('payouts-from-broker')).not.toBeNull();
  });

  it('suppression confirmée : appel, liste rechargée, parent prévenu ; un 404 vaut succès', async () => {
    const { q, api, changed, fixture } = setup();
    q('payout-delete-m1')!.click();
    await fixture.whenStable();
    expect(api.removePayout).toHaveBeenCalledWith('a1', 'm1');
    expect(changed).toHaveBeenCalledTimes(1);
    api.removePayout.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })));
    q('payout-delete-m1')!.click();
    await fixture.whenStable();
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('suppression refusée à la confirmation : rien n\'est envoyé', async () => {
    const { q, api, fixture } = setup({ confirm: false });
    q('payout-delete-m1')!.click();
    await fixture.whenStable();
    expect(api.removePayout).not.toHaveBeenCalled();
  });

  it('refus serveur à l\'ajout : toast avec le message du back', () => {
    const { q, fixture, api, toast, changed } = setup();
    api.addPayout.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Ce compte est connecté à ton broker' } })));
    type(q('payout-amount') as HTMLInputElement, '500');
    fixture.detectChanges();
    q('payout-add')!.click();
    expect(toast.visible()[0]).toMatchObject({ type: 'error', message: 'Ce compte est connecté à ton broker' });
    expect(changed).not.toHaveBeenCalled();
  });

  it('aucun payout : message vide', () => {
    const { q } = setup({ list: [] });
    expect(q('payouts-empty')).not.toBeNull();
  });
});
