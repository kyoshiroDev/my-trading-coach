import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TRIAL_ENDED_SEEN_KEY, TrialEndedModalComponent } from './trial-ended-modal.component';
import { UserStore } from '@app/core/stores/user.store';
import { SelectedAccountStore } from '@app/core/stores/selected-account.store';
import { OfferIntentService } from '@app/core/services/offer-intent.service';
import type { TradingAccount } from '@app/core/api/accounts.api';
import TEMPLATE from './trial-ended-modal.component.html?raw';

/** Fenêtre de fin d'essai (#769) : VRAI template, une seule fois par compte (stockage local). */

const offerIntent = { open: vi.fn() };

function mount(opts: { ended: boolean; accounts?: Partial<TradingAccount>[]; id?: string }) {
  TestBed.configureTestingModule({
    providers: [
      { provide: UserStore, useValue: { user: signal({ id: opts.id ?? 'u1' }), signupTrialEnded: signal(opts.ended) } },
      { provide: SelectedAccountStore, useValue: { accounts: signal(opts.accounts ?? []) } },
      { provide: OfferIntentService, useValue: offerIntent },
    ],
  });
  TestBed.overrideComponent(TrialEndedModalComponent, {
    set: { template: TEMPLATE, imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(TrialEndedModalComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  return { fixture, el, q };
}

describe('Fenêtre de fin d’essai (#769)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(TRIAL_ENDED_SEEN_KEY);
  });

  it('essai en cours ou autre accès Premium : rien', () => {
    expect(mount({ ended: false }).q('trial-ended-modal')).toBeNull();
  });

  it('essai fini : ce qui reste gratuit, ce qui demande Premium, les offres', () => {
    const { q, el } = mount({ ended: true });
    expect(q('trial-ended-modal')).not.toBeNull();
    expect(el.textContent).toContain('Reste gratuit');
    expect(el.textContent).toContain('Demande Premium');
    expect(el.textContent).toContain('rien n\'est supprimé');
    // Valable pour toute durée (essai de 14 jours ou Premium offert par l'admin) : aucune durée citée.
    expect(el.textContent).not.toMatch(/\d+\s*jours/);
    expect(q('trial-ended-accounts')).toBeNull();
  });

  it('une seule fois : fermée, elle ne revient pas pour ce compte', () => {
    const first = mount({ ended: true });
    first.q('trial-ended-close')!.click();
    first.fixture.detectChanges();
    expect(first.q('trial-ended-modal')).toBeNull();
    TestBed.resetTestingModule();
    expect(mount({ ended: true }).q('trial-ended-modal')).toBeNull();
    TestBed.resetTestingModule();
    expect(mount({ ended: true, id: 'u2' }).q('trial-ended-modal')).not.toBeNull(); // autre compte
  });

  it('« Voir les offres » : marquée vue, fenêtre des offres ouverte', () => {
    const { q } = mount({ ended: true });
    q('trial-ended-offers')!.click();
    expect(offerIntent.open).toHaveBeenCalledWith('modale');
    expect(localStorage.getItem(TRIAL_ENDED_SEEN_KEY)).toContain('u1');
  });

  it('comptes en trop : renvoi vers le choix du compte gardé', () => {
    const { q } = mount({ ended: true, accounts: [{ id: 'a', overFreeLimit: false }, { id: 'b', overFreeLimit: true }] });
    expect(q('trial-ended-accounts')).not.toBeNull();
  });
});
