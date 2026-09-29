/**
 * Régression — la suppression de compte utilisateur échouait en silence.
 *
 * `confirmDelete()` relâchait seulement le spinner sur erreur :
 *
 *     error: () => { this.isDeleting.set(false); },
 *
 * Rien à l'écran. L'utilisateur venait de taper SUPPRIMER pour confirmer une action
 * irréversible, voyait « Suppression… » s'arrêter, et restait connecté sans savoir
 * pourquoi. Le déclencheur connu : deux FK de parrainage en RESTRICT (corrigées par
 * migration), qui faisaient échouer la transaction côté back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { ProfileComponent } from './profile.component';
import { UserStore } from '../../core/stores/user.store';
import { AuthService } from '../../core/auth/auth.service';
import { BillingApi } from '../../core/api/billing.api';
import { UsersApi } from '../../core/api/users.api';
import { TradesApi } from '../../core/api/trades.api';
import { SetupsStore } from '../../core/stores/setups.store';
import { AnalyticsApi } from '../../core/api/analytics.api';

function mount(deleteMeImpl: () => unknown) {
  const auth = { currentUser: signal(null), setCurrentUser: vi.fn(), logout: vi.fn() };
  const usersApi = {
    getAiUsage: vi.fn(() => of({ data: null })),
    deleteMe: vi.fn(deleteMeImpl),
  };

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: UserStore,
        useValue: {
          user: () => ({ currency: 'EUR', notificationsEmail: true, debriefAutomatic: true, marketingConsent: false }),
          isPremium: () => false, isDemo: () => false, isInTrial: () => false,
          displayName: () => 'Test', startingCapital: () => 0, refreshUser: vi.fn(),
        },
      },
      { provide: AuthService, useValue: auth },
      { provide: BillingApi, useValue: {} },
      { provide: UsersApi, useValue: usersApi },
      { provide: TradesApi, useValue: { getUserAssets: vi.fn(() => of({ data: [] })) } },
      { provide: SetupsStore, useValue: { active: signal([]), archived: signal([]), load: vi.fn(), loaded: signal(true) } },
      { provide: AnalyticsApi, useValue: { getBySetup: vi.fn(() => of({ data: [] })) } },
    ],
  });
  TestBed.overrideComponent(ProfileComponent, {
    set: {
      template: '<div></div>', imports: [], styleUrls: [],
      styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const fixture = TestBed.createComponent(ProfileComponent);
  fixture.detectChanges();
  return { cmp: fixture.componentInstance as any, auth, usersApi };
}

/** Le formulaire exige le mot SUPPRIMER : sans lui, `confirmDelete` ne fait rien. */
function confirmer(cmp: any) {
  cmp.deleteInput.set('SUPPRIMER');
  cmp.confirmDelete();
}

describe('Profil — un échec de suppression de compte est désormais expliqué', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('erreur serveur → message affiché, spinner relâché, pas de déconnexion', () => {
    const { cmp, auth } = mount(() => throwError(() => ({ error: { message: 'Suppression refusée.' } })));

    confirmer(cmp);

    expect(
      cmp.deleteError(),
      'Le spinner s\'arrête et rien ne s\'affiche : l\'utilisateur ne sait pas ce qui a échoué',
    ).toBe('Suppression refusée.');
    expect(cmp.isDeleting()).toBe(false);
    expect(auth.logout, 'Déconnecter alors que le compte existe encore').not.toHaveBeenCalled();
  });

  it('erreur sans message serveur → repli lisible, jamais « undefined »', () => {
    const { cmp } = mount(() => throwError(() => new Error('500')));

    confirmer(cmp);

    expect(cmp.deleteError()).toContain("n'a pas pu être supprimé");
  });

  it('succès → déconnexion, aucun message (non-régression)', () => {
    const { cmp, auth } = mount(() => of(undefined));

    confirmer(cmp);

    expect(auth.logout).toHaveBeenCalled();
    expect(cmp.deleteError()).toBeNull();
  });

  it('un nouvel essai repart d\'un message vierge', () => {
    const { cmp, usersApi } = mount(() => throwError(() => new Error('500')));
    confirmer(cmp);
    expect(cmp.deleteError()).not.toBeNull();

    usersApi.deleteMe.mockReturnValue(of(undefined));
    confirmer(cmp);

    expect(cmp.deleteError()).toBeNull();
  });

  it('sans le mot SUPPRIMER, rien ne part et rien ne s\'affiche', () => {
    const { cmp, usersApi } = mount(() => of(undefined));

    cmp.deleteInput.set('supprimer'); // minuscules : refusé
    cmp.confirmDelete();

    expect(usersApi.deleteMe).not.toHaveBeenCalled();
    expect(cmp.deleteError()).toBeNull();
  });
});
