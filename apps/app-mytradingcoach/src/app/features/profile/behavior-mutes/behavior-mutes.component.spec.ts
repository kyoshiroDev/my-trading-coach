/**
 * Profil, « Alertes de comportement » (#671) : détecteurs coupés réactivables, état vide, verrou pour un
 * compte gratuit, échec de chargement.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { of, throwError } from 'rxjs';
import { BehaviorMutesComponent } from './behavior-mutes.component';
import { BehaviorApi } from '@app/core/api/behavior.api';
import { UserStore } from '@app/core/stores/user.store';
import TEMPLATE from './behavior-mutes.component.html?raw';

describe('BehaviorMutesComponent (#671)', () => {
  const api = { getMutes: vi.fn(), unmute: vi.fn(() => of(undefined)) };
  const premium = signal(true);

  beforeEach(() => {
    TestBed.resetTestingModule();
    api.getMutes.mockReset();
    api.unmute.mockClear();
    premium.set(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: BehaviorApi, useValue: api },
        { provide: UserStore, useValue: { isPremium: premium } },
      ],
    });
    TestBed.overrideComponent(BehaviorMutesComponent, {
      set: { template: TEMPLATE, imports: [DatePipe], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
    });
  });

  function render() {
    const f = TestBed.createComponent(BehaviorMutesComponent);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement };
  }

  it('liste des détecteurs coupés ; « Réactiver » nommé, retire la ligne', () => {
    api.getMutes.mockReturnValue(of({ data: [{ detector: 'C2_OVER_DAILY_LIMIT', createdAt: '2026-11-24T10:00:00.000Z' }] }));
    const { f, el } = render();
    const btn = el.querySelector('[data-testid="behavior-unmute-C2_OVER_DAILY_LIMIT"]') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Réactiver « Au-delà de ta limite de trades »');
    btn.click();
    f.detectChanges();
    expect(api.unmute).toHaveBeenCalledWith('C2_OVER_DAILY_LIMIT');
    expect(el.querySelector('[data-testid="behavior-mutes-empty"]')).not.toBeNull();
  });

  it('compte gratuit : verrou, aucun appel', () => {
    premium.set(false);
    const { el } = render();
    expect(el.querySelector('mtc-premium-lock')).not.toBeNull();
    expect(api.getMutes).not.toHaveBeenCalled();
  });

  it('échec de chargement : message d’erreur', () => {
    api.getMutes.mockReturnValue(throwError(() => new Error('down')));
    expect(render().el.querySelector('mtc-error-state')).not.toBeNull();
  });
});
