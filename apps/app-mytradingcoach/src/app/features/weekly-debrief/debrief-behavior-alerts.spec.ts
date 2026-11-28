/**
 * Débrief hebdo, « Alertes de la semaine » (#671) : liste des alertes et ce qui a suivi, bloc masqué sans
 * alerte, message d'échec avec « Réessayer ».
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { of, throwError } from 'rxjs';
import type { BehaviorAlertHistoryItem } from '@mtc/shared';
import { DebriefBehaviorAlertsComponent } from './debrief-behavior-alerts.component';
import { BehaviorApi } from '../../core/api/behavior.api';
import { PnlFormatPipe } from '../../shared/pipes/pnl-format.pipe';
import TEMPLATE from './debrief-behavior-alerts.component.html?raw';


const item = (o: Partial<BehaviorAlertHistoryItem> = {}): BehaviorAlertHistoryItem => ({
  id: 'x1', accountId: 'apex', type: 'C1_LOSS_STREAK', severity: 'high', message: 'Nouvelle entrée après 3 pertes d’affilée dans la séance.',
  createdAt: '2026-11-25T14:51:00.000Z', mutedByUser: false, after: { count: 2, pnl: -212.5 }, ...o,
});

describe('DebriefBehaviorAlertsComponent (#671)', () => {
  const api = { getAlerts: vi.fn() };

  beforeEach(() => {
    // Dates écrites en dur : horloge figée (règle tests n° 1).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-27T12:00:00Z'));
    TestBed.resetTestingModule();
    api.getAlerts.mockReset();
    TestBed.configureTestingModule({ providers: [{ provide: BehaviorApi, useValue: api }] });
    TestBed.overrideComponent(DebriefBehaviorAlertsComponent, {
      set: { template: TEMPLATE, imports: [DatePipe, PnlFormatPipe], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
    });
  });

  afterEach(() => vi.useRealTimers());

  function render() {
    const f = TestBed.createComponent(DebriefBehaviorAlertsComponent);
    // JIT sous vitest : les `input()` ne se règlent pas par setInput, on remplace leur signal.
    const c = f.componentInstance as unknown as Record<string, unknown>;
    c['from'] = signal('2026-11-23');
    c['to'] = signal('2026-11-29');
    f.detectChanges();
    TestBed.tick();
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('alertes de la semaine : gravité en texte, détecteur, message, ce qui a suivi, « coupé »', () => {
    api.getAlerts.mockReturnValue(of({ data: [item(), item({ id: 'x2', type: 'C2_OVER_DAILY_LIMIT', severity: 'medium', mutedByUser: true, after: { count: 1, pnl: 45 } })] }));
    const el = render();
    expect(api.getAlerts).toHaveBeenCalledWith('2026-11-23', '2026-11-29');
    const first = el.querySelector('[data-testid="debrief-behavior-alert-x1"]')!;
    expect(first.textContent).toContain('Gravité haute');
    expect(first.textContent).toContain('Pertes d’affilée');
    expect(first.textContent).toContain('Ensuite\u00a0: 2 trades');
    expect(first.querySelector('.dot')?.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('[data-testid="debrief-behavior-alert-x2"]')?.textContent).toContain('coupé');
  });

  it('aucune alerte : bloc masqué', () => {
    api.getAlerts.mockReturnValue(of({ data: [] }));
    expect(render().querySelector('[data-testid="debrief-behavior-alerts"]')).toBeNull();
  });

  it('échec : carte avec le message d’erreur', () => {
    api.getAlerts.mockReturnValue(throwError(() => new Error('down')));
    const el = render();
    expect(el.querySelector('[data-testid="debrief-behavior-alerts"]')).not.toBeNull();
    expect(el.querySelector('mtc-error-state')).not.toBeNull();
  });
});
