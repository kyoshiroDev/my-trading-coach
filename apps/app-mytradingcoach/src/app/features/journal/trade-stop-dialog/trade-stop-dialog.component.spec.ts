/**
 * Saisie rapide du stop initial (Journal) : aperçu en direct du risque et du R/R, refus d'un stop du
 * mauvais côté, corps envoyé à PATCH /trades/:id/stop.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { TradeStopDialogComponent } from './trade-stop-dialog.component';
import { TradesApi, Trade } from '../../../core/api/trades.api';
import { MoneyService } from '../../../core/services/money.service';

// Vrai template, lu sur disque (les ressources externes ne se résolvent pas sous vitest).
const TEMPLATE = readFileSync(join(__dirname, 'trade-stop-dialog.component.html'), 'utf8');

const INSTRUMENTS = [
  { symbol: 'MNQ', label: 'Micro E-mini Nasdaq (MNQ)', category: 'FUTURES_US', tickValue: 0.5, tickSize: 0.25 },
  { symbol: 'MGC', label: 'Micro Gold (MGC)', category: 'FUTURES_US', tickValue: 1, tickSize: 0.1 },
];

// MNQ du 9/11 (compte Lucid) tel que synchronisé : aucun stop, aucun objectif.
const synced = (over: Partial<Trade> = {}): Trade => ({
  id: 'sync-1', userId: 'u1', asset: 'MNQ', side: 'LONG', entry: 27092.25, exit: 27796,
  stopLoss: null, takeProfit: null, pnl: 1407.5, commission: 1.9, riskReward: null, quantity: 1,
  capitalEngaged: null, emotion: null, setupId: 's1', setup: { id: 's1', title: 'S', color: '#fff' },
  accountId: 'acc-1', session: 'NEW_YORK', timeframe: '5m', notes: null, tags: [],
  tradedAt: '2026-11-09T15:11:08.000Z', createdAt: '2026-11-09T15:11:10.000Z',
  ...over,
});

let api: { getInstruments: ReturnType<typeof vi.fn>; setStop: ReturnType<typeof vi.fn> };

async function render(trade: Trade): Promise<ComponentFixture<TradeStopDialogComponent>> {
  TestBed.configureTestingModule({
    providers: [
      { provide: TradesApi, useValue: api },
      {
        provide: MoneyService,
        useValue: {
          format: (v: number) => `$${v.toFixed(2)}`,
          formatFor: (_id: string, v: number) => `$${v.toFixed(2)}`,
        },
      },
    ],
  });
  TestBed.overrideComponent(TradeStopDialogComponent, {
    set: { template: TEMPLATE, styleUrls: [], styleUrl: undefined as unknown as string },
  });
  await TestBed.compileComponents();
  const fixture = TestBed.createComponent(TradeStopDialogComponent);
  // JIT (vitest) ne voit pas input() : signal posé directement, comme plan-modal-signup-trial.spec.
  (fixture.componentInstance as unknown as Record<string, unknown>)['trade'] = signal(trade);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

const q = (f: ComponentFixture<unknown>, id: string) =>
  (f.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const txt = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

function type(f: ComponentFixture<unknown>, id: string, value: string): void {
  const input = q(f, id) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  f.detectChanges();
}

describe('TradeStopDialogComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    api = {
      getInstruments: vi.fn(() => of({ data: INSTRUMENTS })),
      setStop: vi.fn((id: string, body: { stopLoss: number; takeProfit?: number | null }) =>
        of({ data: synced({ id, ...body, riskReward: body.takeProfit ? 4.55 : null }) })),
    };
  });

  it('LONG, stop + objectif : risque en dollars (valeur du point MNQ) et R/R en direct', async () => {
    const f = await render(synced());
    type(f, 'trade-stop-input', '26862.50');
    expect(txt(q(f, 'trade-stop-risk'))).toBe('$459.50'); // 229.75 pts × 2 $
    expect(txt(q(f, 'trade-stop-rr'))).toBe('—');
    type(f, 'trade-target-input', '28138,25'); // virgule décimale acceptée
    expect(txt(q(f, 'trade-stop-rr'))).toBe('4.55');
    expect((q(f, 'trade-stop-save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('SHORT : R/R dans le bon sens', async () => {
    const f = await render(synced({ asset: 'MGC', side: 'SHORT', entry: 4134.6, exit: 4120 }));
    type(f, 'trade-stop-input', '4144.6');
    type(f, 'trade-target-input', '4114.6');
    expect(txt(q(f, 'trade-stop-risk'))).toBe('$100.00'); // 10 pts × 10 $
    expect(txt(q(f, 'trade-stop-rr'))).toBe('2.00');
  });

  it('stop du mauvais côté : message clair, enregistrement impossible', async () => {
    const f = await render(synced());
    type(f, 'trade-stop-input', '27100');
    expect(txt(q(f, 'trade-stop-error'))).toBe("Sur un achat (LONG), le stop doit être sous le prix d'entrée (27092.25).");
    expect(q(f, 'trade-stop-risk')).toBeNull();
    expect((q(f, 'trade-stop-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('saisie illisible : refusée', async () => {
    const f = await render(synced());
    type(f, 'trade-stop-input', 'abc');
    expect(txt(q(f, 'trade-stop-error'))).toBe('Le stop doit être un nombre.');
  });

  it('sans objectif : envoie le stop seul (objectif inchangé), R/R affiché « — »', async () => {
    const f = await render(synced());
    type(f, 'trade-stop-input', '26862.5');
    expect(txt(q(f, 'trade-stop-rr'))).toBe('—');
    const saved = vi.fn();
    f.componentInstance.saved.subscribe(saved);
    (q(f, 'trade-stop-save') as HTMLButtonElement).click();
    expect(api.setStop).toHaveBeenCalledWith('sync-1', { stopLoss: 26862.5 });
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ id: 'sync-1', stopLoss: 26862.5, riskReward: null }));
  });

  it('stop + objectif : corps complet envoyé', async () => {
    const f = await render(synced());
    type(f, 'trade-stop-input', '26862.5');
    type(f, 'trade-target-input', '28138.25');
    (q(f, 'trade-stop-save') as HTMLButtonElement).click();
    expect(api.setStop).toHaveBeenCalledWith('sync-1', { stopLoss: 26862.5, takeProfit: 28138.25 });
  });

  it('objectif existant vidé : envoyé à null (retiré)', async () => {
    const f = await render(synced({ stopLoss: 26862.5, takeProfit: 28138.25 }));
    expect((q(f, 'trade-stop-input') as HTMLInputElement).value).toBe('26862.5'); // pré-rempli
    type(f, 'trade-target-input', '');
    (q(f, 'trade-stop-save') as HTMLButtonElement).click();
    expect(api.setStop).toHaveBeenCalledWith('sync-1', { stopLoss: 26862.5, takeProfit: null });
  });

  it('instrument sans valeur du point : risque en points, et on le dit', async () => {
    const f = await render(synced({ asset: 'XYZ', entry: 100, exit: 110 }));
    type(f, 'trade-stop-input', '95');
    expect(txt(q(f, 'trade-stop-risk'))).toBe('5 pts');
    expect(txt(q(f, 'trade-stop-no-point-value'))).toContain('Valeur du point inconnue pour XYZ');
  });

  it('refus de l’API : son message est affiché, la fenêtre reste ouverte', async () => {
    api.setStop.mockReturnValueOnce(throwError(() => new HttpErrorResponse({
      status: 400, error: { message: "Sur un achat (LONG), le stop doit être sous le prix d'entrée (27092.25)." },
    })));
    const f = await render(synced());
    const saved = vi.fn();
    f.componentInstance.saved.subscribe(saved);
    type(f, 'trade-stop-input', '26862.5');
    (q(f, 'trade-stop-save') as HTMLButtonElement).click();
    f.detectChanges();
    expect(txt(q(f, 'trade-stop-api-error'))).toContain('sous le prix d\'entrée');
    expect(saved).not.toHaveBeenCalled();
  });
});
