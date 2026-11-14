/**
 * Formulaire de trade — envoi (audit fonctionnel #994, lot 1c #997).
 * F2 : les frais saisis partaient-ils ? `CreateTradeSchema` (zod) retire les clés qu'il ne connaît
 *      pas, et `commission` n'y était pas : le trade était créé sans frais.
 * F1 : après un premier envoi refusé, `tradedAt` avait été remplacé par l'ISO ; le 2e clic levait
 *      `RangeError: Invalid time value` et le formulaire restait bloqué.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { DecimalPipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { of } from 'rxjs';
import { PnlFormatPipe } from '../../shared/pipes';
import { TradeFormComponent } from './trade-form.component';
import { SetupsStore } from '../../core/stores/setups.store';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { TradesApi, type InstrumentDto } from '../../core/api/trades.api';
import { statsScopeStub } from '../../core/stores/selected-account.store.stub';
import type { CreateTradeDto } from '../../core/api/trades.api';

// Formulaire ouvert : en JIT (specs), les `input()` signal ne sont pas liables par `setInput`.
const FORM_HTML = readFileSync(join(__dirname, 'trade-form.component.html'), 'utf8').replace('@if (open()) {', '@if (true) {');

const INSTRUMENTS = [
  { symbol: 'EUR/USD', label: 'Euro / Dollar (EUR/USD)', category: 'FOREX', tickValue: 10, tickSize: 0.0001, pipDecimals: 4 },
  { symbol: 'MNQ', label: 'Micro E-mini Nasdaq (MNQ)', category: 'FUTURES_US', tickValue: 0.5, tickSize: 0.25 },
] as unknown as InstrumentDto[];

/** Accès aux membres protégés du composant, pour piloter la saisie comme le ferait le template. */
type FormInternals = {
  form: { update: (fn: (f: Partial<CreateTradeDto>) => Partial<CreateTradeDto>) => void };
  selectInstrument: (i: InstrumentDto) => void;
  recalculate: () => void;
  autoPnl: () => number | undefined;
  exitMode: { set: (m: 'SL' | 'TP' | null) => void };
  onSubmit: () => void;
};

async function render() {
  TestBed.configureTestingModule({
    providers: [
      { provide: SetupsStore, useValue: { active: signal([{ id: 's1', title: 'Breakout', color: '#fff' }]), load: vi.fn(), loaded: signal(true) } },
      {
        provide: SelectedAccountStore,
        useValue: {
          ...statsScopeStub(),
          accounts: signal([]), activeAccounts: signal([]), accountParam: () => undefined,
          selected: () => null, selectedAccountId: signal('all'), displayCurrency: signal('USD'),
          currencyOf: () => 'USD', load: vi.fn(), loaded: signal(true), isLoading: signal(false),
        },
      },
      { provide: TradesApi, useValue: { getInstruments: () => of({ data: INSTRUMENTS }) } },
    ],
  });
  TestBed.overrideComponent(TradeFormComponent, {
    set: {
      template: FORM_HTML, styleUrls: [], styleUrl: undefined as unknown as string,
      imports: [FormsModule, TitleCasePipe, DecimalPipe, PnlFormatPipe],
      schemas: [NO_ERRORS_SCHEMA],
    },
  });
  await TestBed.compileComponents();
  const fixture = TestBed.createComponent(TradeFormComponent);
  fixture.detectChanges();
  const cmp = fixture.componentInstance as unknown as FormInternals;
  const saved: CreateTradeDto[] = [];
  fixture.componentInstance.formSave.subscribe((dto) => saved.push(dto));
  const fill = (patch: Partial<CreateTradeDto>) => {
    cmp.form.update((f) => ({ ...f, ...patch }));
    cmp.recalculate();
    fixture.detectChanges();
  };
  return { fixture, cmp, saved, fill, el: fixture.nativeElement as HTMLElement };
}

const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('Formulaire de trade — envoi', () => {
  it('frais saisis : envoyés avec le trade (création comme édition)', async () => {
    const { cmp, fill, saved } = await render();
    cmp.selectInstrument(INSTRUMENTS[1]);
    fill({ side: 'LONG', entry: 18600, exit: 18605, commission: 4.5 });
    cmp.onSubmit();
    expect(saved).toHaveLength(1);
    expect(saved[0].commission).toBe(4.5);
  });

  it('frais négatifs refusés côté formulaire, jamais envoyés', async () => {
    const { cmp, fill, saved } = await render();
    cmp.selectInstrument(INSTRUMENTS[1]);
    fill({ side: 'LONG', entry: 18600, exit: 18605, commission: -2 });
    cmp.onSubmit();
    expect(saved).toHaveLength(0);
  });

  it('premier envoi refusé (actif vide), puis corrigé : le 2e envoi part, sans exception', async () => {
    const { cmp, fill, saved } = await render();
    fill({ asset: '', side: 'LONG', entry: 100, exit: 110, tradedAt: '2026-06-01' });
    cmp.onSubmit();
    expect(saved).toHaveLength(0);
    fill({ asset: 'BTC/USDT' });
    expect(() => cmp.onSubmit()).not.toThrow();
    expect(saved).toHaveLength(1);
    expect(saved[0].tradedAt).toBe(new Date('2026-06-01T12:00:00').toISOString());
  });

  // F4 : seules les erreurs d'entrée et de capital étaient affichées ; actif ou setup manquant =
  // clic sans effet visible.
  it('actif manquant : message affiché sous le champ', async () => {
    const { cmp, fill, el, fixture } = await render();
    fill({ asset: '', side: 'LONG', entry: 100, exit: 110 });
    cmp.onSubmit();
    fixture.detectChanges();
    expect(text(el.querySelector('[data-testid="trade-asset-error"]'))).toBe('Choisis un actif.');
  });

  it('setup manquant : message affiché sous les setups', async () => {
    const { cmp, fill, el, fixture } = await render();
    fill({ asset: 'BTC/USDT', side: 'LONG', entry: 100, exit: 110, setupId: '' });
    cmp.onSubmit();
    fixture.detectChanges();
    expect(text(el.querySelector('[data-testid="trade-setup-error"]'))).toBe('Choisis un setup.');
  });
});
