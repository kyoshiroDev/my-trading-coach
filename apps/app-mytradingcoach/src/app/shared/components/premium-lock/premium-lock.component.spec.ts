import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import * as angularCore from '@angular/core';
import { PremiumLockComponent } from './premium-lock.component';
import { OffersStore } from '@app/core/stores/offers.store';
import { UserStore } from '@app/core/stores/user.store';
import { OfferIntentService } from '@app/core/services/offer-intent.service';
import { ProductEventsService } from '@app/core/services/product-events.service';

// Cadenas Premium (#525) : mentionne l'offre fondateur si elle est accessible, et ouvre la modale
// (cta=cadenas) au lieu de l'ancien lien vers /parametres, une route inexistante.

const resolveComponentResources = (
  angularCore as Record<string, unknown>
)['ɵresolveComponentResources'] as (
  resolver: (url: string) => Promise<{ text(): Promise<string> }>,
) => Promise<void>;

beforeAll(async () => {
  // styleUrl en JIT : feuille vide (seul le DOM est testé).
  await resolveComponentResources(() =>
    Promise.resolve({ text: () => Promise.resolve('') } as unknown as Response),
  );
});

function render(founderAvailable: boolean, trialAvailable = true) {
  const intent = { open: vi.fn() };
  TestBed.configureTestingModule({
    imports: [PremiumLockComponent],
    providers: [
      { provide: OffersStore, useValue: { founderAvailable: signal(founderAvailable), load: vi.fn() } },
      { provide: UserStore, useValue: { trialAvailable: signal(trialAvailable) } },
      { provide: OfferIntentService, useValue: intent },
      { provide: ProductEventsService, useValue: { once: vi.fn(), track: vi.fn() } },
    ],
  });
  const fixture = TestBed.createComponent(PremiumLockComponent);
  fixture.detectChanges();
  const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid=premium-lock-cta]')!;
  return { button, intent };
}

describe('PremiumLockComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('offre fondateur accessible : « dès 29 €/mois (offre fondateur) »', () => {
    expect(render(true).button.textContent).toContain('dès 29 €/mois (offre fondateur)');
  });

  it('sinon : essai d’un mois, ou passage direct si l’essai est consommé', () => {
    expect(render(false).button.textContent).toContain('Essayer Premium · 1 mois offert');
    TestBed.resetTestingModule();
    expect(render(false, false).button.textContent).toContain('Passer à Premium');
  });

  it('clic : ouvre la modale avec cta=cadenas (plus de lien vers /parametres)', () => {
    const { button, intent } = render(true);
    expect(button.tagName).toBe('BUTTON');
    button.click();
    expect(intent.open).toHaveBeenCalledWith('cadenas');
  });
});
