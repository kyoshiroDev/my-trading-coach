/**
 * Formulaire de trade — forex en saisie manuelle (#951).
 *
 * Paires cotées en dollars : P&L en pips (1 lot = 100 000, 1 pip = 10 $ par lot), quantité affichée
 * en lots. Paires hors dollar (USD/JPY…) : aucun P&L dans la devise de cotation, le capital engagé
 * est exigé avant l'envoi. Vrai template, comme `journal-rr-unknown.spec.ts`.
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

describe('Formulaire de trade — forex (#951)', () => {
  it('EUR/USD LONG 1,0800 → 1,0850, 1 lot : +500 $, quantité en lots', async () => {
    const { cmp, fill, el, fixture } = await render();
    cmp.selectInstrument(INSTRUMENTS[0]);
    fill({ side: 'LONG', entry: 1.08, exit: 1.085, quantity: 1 });
    expect(cmp.autoPnl()).toBe(500);
    expect(text(el.querySelector('[data-testid="trade-qty-label"]'))).toBe('Quantité (lots)');
    expect(text(el.querySelector('#tf-qty-lots'))).toBe('1 lot = 100 000 unités · 1 pip = 10 $ par lot');
    fixture.detectChanges();
  });

  it('future : libellé « Quantité » sans aide en lots', async () => {
    const { cmp, fill, el } = await render();
    cmp.selectInstrument(INSTRUMENTS[1]);
    fill({ entry: 18600, exit: 18605 });
    expect(text(el.querySelector('[data-testid="trade-qty-label"]'))).toBe('Quantité');
    expect(el.querySelector('#tf-qty-lots')).toBeNull();
  });

  it('USD/JPY sans capital : aide affichée, erreur, rien n’est envoyé', async () => {
    const { cmp, fill, el, saved, fixture } = await render();
    fill({ asset: 'USD/JPY', side: 'LONG', entry: 150, exit: 151 });
    expect(el.querySelector('[data-testid="forex-non-usd-hint"]')).not.toBeNull();
    expect(cmp.autoPnl()).toBeUndefined();
    cmp.onSubmit();
    fixture.detectChanges();
    expect(saved).toHaveLength(0);
    expect(text(el.querySelector('[role="alert"]'))).toBe('Indique le capital engagé : cette paire n’est pas cotée en dollars.');
  });

  it('USD/JPY sortie par le mode TP, sans capital : bloqué aussi', async () => {
    const { cmp, fill, saved } = await render();
    fill({ asset: 'USD/JPY', side: 'LONG', entry: 150, stopLoss: 149, takeProfit: 152 });
    cmp.exitMode.set('TP');
    cmp.recalculate();
    cmp.onSubmit();
    expect(saved).toHaveLength(0);
  });

  it('USD/JPY avec capital : P&L = variation × capital, le trade est envoyé', async () => {
    const { cmp, fill, saved } = await render();
    fill({ asset: 'USD/JPY', side: 'LONG', entry: 150, exit: 151.5, capitalEngaged: 10_000 });
    expect(cmp.autoPnl()).toBe(100);
    cmp.onSubmit();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ asset: 'USD/JPY', pnl: 100, capitalEngaged: 10_000 });
  });
});
