import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TopbarComponent } from './topbar.component';
import { UserStore } from '../../../core/stores/user.store';
import { OfferIntentService } from '../../../core/services/offer-intent.service';

/** Bandeau d'essai d'inscription dans l'en-tête des pages (#769). */

const offerIntent = { open: vi.fn() };

function mount(days: number | null) {
  TestBed.configureTestingModule({
    providers: [
      { provide: UserStore, useValue: { signupTrialDaysLeft: signal(days) } },
      { provide: OfferIntentService, useValue: offerIntent },
    ],
  });
  TestBed.overrideComponent(TopbarComponent, {
    set: { imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(TopbarComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { el, strip: el.querySelector<HTMLElement>('[data-testid="trial-strip"]') };
}

describe('Bandeau « Premium offert » (#769)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hors essai d’inscription (gratuit, abonné, offert par l’admin, démo) : rien', () => {
    expect(mount(null).strip).toBeNull();
  });

  it('jours restants, puis « dernier jour »', () => {
    expect(mount(9).strip?.textContent?.replace(/\s+/g, ' ')).toContain('Premium offert · il te reste 9 jours');
    TestBed.resetTestingModule();
    expect(mount(1).strip?.textContent?.replace(/\s+/g, ' ')).toContain('dernier jour');
  });

  it('« Voir les offres » ouvre la fenêtre des offres (point de clic bandeau)', () => {
    const { el } = mount(5);
    el.querySelector<HTMLButtonElement>('[data-testid="trial-strip-offers"]')!.click();
    expect(offerIntent.open).toHaveBeenCalledWith('bandeau');
  });
});
