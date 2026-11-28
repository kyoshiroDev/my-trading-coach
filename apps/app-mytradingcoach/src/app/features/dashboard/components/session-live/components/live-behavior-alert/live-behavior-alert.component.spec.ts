/**
 * Bandeau d'alerte de comportement (#671) : phrase du serveur, ambre ou rouge, compte cité s'il diffère
 * de la séance, « Pas pour mon style » qui coupe le détecteur, croix qui ferme, annonce unique.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { LiveBehaviorAlertComponent } from './live-behavior-alert.component';
import { BehaviorAlertsStore } from '@app/core/stores/behavior-alerts.store';
import { BehaviorApi } from '@app/core/api/behavior.api';
import { SelectedAccountStore } from '@app/core/stores/selected-account.store';
import { ToastService } from '@app/core/services/toast.service';
import type { BehaviorAlertEvent } from '@mtc/shared';
import { DatePipe } from '@angular/common';
import { LucideDynamicIcon } from '@lucide/angular';
import TEMPLATE from './live-behavior-alert.component.html?raw';

const ev = (o: Partial<BehaviorAlertEvent> = {}): BehaviorAlertEvent => ({
  id: 'x1', accountId: 'apex', type: 'B_REVENGE', severity: 'medium', message: 'Nouvelle entrée NQ\u00a0: 40 s après la perte.', context: {}, ...o,
});

describe('LiveBehaviorAlertComponent (#671)', () => {
  const api = { mute: vi.fn(() => of({ data: { detector: 'B_REVENGE', createdAt: '' } })), getConfig: vi.fn() };
  const toast = { error: vi.fn() };
  let store: BehaviorAlertsStore;

  beforeEach(() => {
    TestBed.resetTestingModule();
    api.mute.mockClear();
    toast.error.mockClear();
    TestBed.configureTestingModule({
      providers: [
        { provide: BehaviorApi, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: SelectedAccountStore, useValue: { accounts: signal([{ id: 'apex', label: 'Apex 50K' }, { id: 'tdy', label: 'Tradeify 50K' }]) } },
      ],
    });
    TestBed.overrideComponent(LiveBehaviorAlertComponent, {
      set: { template: TEMPLATE, imports: [DatePipe, LucideDynamicIcon], styleUrls: [], styleUrl: undefined as unknown as string },
    });
    store = TestBed.inject(BehaviorAlertsStore);
    store.uiEnabled.set(true);
  });

  function render(sessionAccountId = 'apex') {
    const f = TestBed.createComponent(LiveBehaviorAlertComponent);
    // JIT sous vitest : les `input()` ne se règlent pas par setInput, on remplace leur signal.
    (f.componentInstance as unknown as Record<string, unknown>)['sessionAccountId'] = signal(sessionAccountId);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement };
  }

  it('aucune alerte : pas de bandeau, zones d’annonce présentes et vides', () => {
    const { el } = render();
    expect(el.querySelector('[data-testid="behavior-alert"]')).toBeNull();
    const live = el.querySelectorAll('[aria-live]');
    expect([...live].map((n) => n.getAttribute('aria-live'))).toEqual(['polite', 'assertive']);
    expect([...live].every((n) => n.textContent?.trim() === '')).toBe(true);
  });

  it('alerte moyenne : ambre, phrase exacte, compte de la séance non cité, annonce polie seulement', () => {
    store.push(ev());
    const { el } = render();
    const ba = el.querySelector('[data-testid="behavior-alert"]')!;
    expect(ba.getAttribute('data-tone')).toBe('amber');
    expect(ba.hasAttribute('role')).toBe(false);
    expect(el.querySelector('[data-testid="behavior-alert-message"]')?.textContent).toBe('Nouvelle entrée NQ\u00a0: 40 s après la perte.');
    expect(ba.textContent).toContain('Trade de vengeance');
    expect(ba.textContent).not.toContain('Apex 50K');
    expect(el.querySelector('[aria-live="polite"]')?.textContent).toContain('Trade de vengeance');
    expect(el.querySelector('[aria-live="assertive"]')?.textContent?.trim()).toBe('');
  });

  it('gravité haute d’un autre compte : rouge, compte cité, annonce assertive', () => {
    store.push(ev({ id: 'x2', accountId: 'tdy', type: 'C1_LOSS_STREAK', severity: 'high', message: 'Nouvelle entrée après 3 pertes d’affilée dans la séance.' }));
    const { el } = render();
    expect(el.querySelector('[data-testid="behavior-alert"]')?.getAttribute('data-tone')).toBe('red');
    expect(el.textContent).toContain('Tradeify 50K');
    expect(el.querySelector('[aria-live="assertive"]')?.textContent).toContain('Pertes d’affilée');
  });

  it('« Pas pour mon style » : coupe le détecteur et ferme ; échec : message', () => {
    store.push(ev());
    const { f, el } = render();
    (el.querySelector('[data-testid="behavior-mute"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(api.mute).toHaveBeenCalledWith('B_REVENGE');
    expect(el.querySelector('[data-testid="behavior-alert"]')).toBeNull();
    api.mute.mockReturnValueOnce(throwError(() => new Error('down')) as never);
    store.push(ev({ id: 'x3' }));
    f.detectChanges();
    (el.querySelector('[data-testid="behavior-mute"]') as HTMLButtonElement).click();
    expect(toast.error).toHaveBeenCalled();
  });

  it('croix : ferme sans couper le détecteur', () => {
    store.push(ev());
    const { f, el } = render();
    (el.querySelector('[data-testid="behavior-dismiss"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('[data-testid="behavior-alert"]')).toBeNull();
    expect(api.mute).not.toHaveBeenCalled();
  });

  it('flag éteint : l’événement est ignoré', () => {
    store.uiEnabled.set(false);
    store.push(ev());
    expect(store.alerts()).toEqual([]);
  });
});
