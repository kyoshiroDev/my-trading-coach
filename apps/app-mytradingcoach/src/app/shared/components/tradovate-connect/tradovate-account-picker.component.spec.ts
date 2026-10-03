import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TradovateAccountPickerComponent } from './tradovate-account-picker.component';
import type { TradovateExternalAccount } from '@app/core/api/tradovate.api';

/** Le sélecteur s'affiche à chaque première connexion, y compris pour un compte unique. */
function mount(accounts: TradovateExternalAccount[]) {
  // Feuille de style non résolue en JIT sous vitest (cf. accounts-tradovate.spec).
  TestBed.overrideComponent(TradovateAccountPickerComponent, {
    set: { styleUrls: [], styleUrl: undefined as unknown as string },
  });
  const fixture = TestBed.createComponent(TradovateAccountPickerComponent);
  // Entrées SIGNAL non alimentées en JIT sous vitest : remplacées avant le premier rendu
  // (même contournement que tradovate-connect-modal.component.spec.ts).
  const cmp = fixture.componentInstance as unknown as Record<string, unknown>;
  cmp['accounts'] = signal(accounts);
  cmp['busy'] = signal(false);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const picked: string[] = [];
  fixture.componentInstance.picked.subscribe((id) => picked.push(id));
  return { el, picked, fixture };
}

describe('TradovateAccountPickerComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('compte unique : présélectionné, à confirmer, rien d’importé avant', () => {
    const { el, picked } = mount([{ id: '7', name: 'APEX-1', env: 'demo' }]);
    expect(el.querySelector('.tvp-q')!.textContent).toContain("rien n'est importé avant ta confirmation");
    expect((el.querySelector('[data-testid="tradovate-pick-7"]') as HTMLInputElement).checked).toBe(true);
    const confirm = el.querySelector('[data-testid="tradovate-pick-confirm"]') as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    expect(picked).toEqual([]);
    confirm.click();
    expect(picked).toEqual(['7']);
  });

  it('plusieurs comptes : aucun présélectionné, il faut choisir', () => {
    const { el } = mount([
      { id: '1', name: 'LIVE-1', env: 'live' },
      { id: '2', name: 'DEMO-2', env: 'demo' },
    ]);
    expect(el.querySelector('.tvp-q')!.textContent).toContain('Lequel synchroniser');
    expect((el.querySelector('[data-testid="tradovate-pick-confirm"]') as HTMLButtonElement).disabled).toBe(true);
  });
});
