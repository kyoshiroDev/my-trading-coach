/**
 * après un import Tradovate sans Cash history, le rappel « frais non
 * importés » doit apparaître.
 *
 * Constat navigateur : import Performance seul → 20 trades, P&L brut
 * (+466,50 au lieu de +444,66), `Frais -0,00`, et aucun message. Un hint existe
 * AVANT l'import, rien après : l'écart de 21,84 $ passait inaperçu.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { CsvImportComponent } from './csv-import.component';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { SetupsStore } from '../../core/stores/setups.store';

function mount() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SetupsStore, useValue: { active: signal([]), load: vi.fn(), loaded: signal(true) } },
      {
        provide: SelectedAccountStore,
        useValue: {
          activeAccounts: signal([]), selectedAccountId: signal('all'),
          load: vi.fn(), loaded: signal(true),
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
  fixture.detectChanges();
  return fixture.componentInstance as any;
}

const OK_RESULT = { created: 20, duplicates: 0, failed: 0, total: 20 };

describe('CsvImportComponent — rappel des frais non importés', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('Tradovate sans Cash history ni total saisi → rappel affiché', () => {
    const cmp = mount();
    cmp.source.set('tradovate');
    cmp.result.set(OK_RESULT);

    expect(
      cmp.feesReminder(),
      'Sans rappel, le P&L brut passe pour un P&L net',
    ).toBe(true);
  });

  it('Cash history fourni et fusionné → aucun rappel', () => {
    const cmp = mount();
    cmp.source.set('tradovate');
    cmp.result.set({
      ...OK_RESULT,
      feesImported: { assigned: 21.84, expected: 21.84, reconciled: true, count: 20 },
    });

    expect(cmp.feesReminder()).toBe(false);
  });

  it('Cash history illisible → pas de doublon de message (l\'avertissement #8 suffit)', () => {
    const cmp = mount();
    cmp.source.set('tradovate');
    cmp.result.set({
      ...OK_RESULT,
      feesImported: { assigned: 0, expected: 0, reconciled: false, merged: false, count: 20 },
    });

    expect(cmp.feesReminder()).toBe(false);
  });

  it('total des frais saisi à la main → aucun rappel', () => {
    const cmp = mount();
    cmp.source.set('tradovate');
    cmp.totalFees.set('21,84');
    cmp.result.set(OK_RESULT);

    expect(cmp.feesReminder()).toBe(false);
  });

  it('autre broker (frais déjà dans le CSV) → aucun rappel', () => {
    const cmp = mount();
    cmp.source.set('other');
    cmp.result.set(OK_RESULT);

    expect(cmp.feesReminder()).toBe(false);
  });

  it('import sans aucun trade créé → aucun rappel (rien à nuancer)', () => {
    const cmp = mount();
    cmp.source.set('tradovate');
    cmp.result.set({ created: 0, duplicates: 20, failed: 0, total: 20 });

    expect(cmp.feesReminder()).toBe(false);
  });
});
