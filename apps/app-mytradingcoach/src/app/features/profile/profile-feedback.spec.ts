/**
 * Audit fonctionnel #994 (lot 1d #998) — profil.
 * F14 : suppression / archivage de setup, nom, réinitialisation du mot de passe, actifs favoris :
 *       un refus de l'API repartait dans le vide (le setup réapparaissait sans explication).
 * F23 : « SUPPRIMER » exigé à l'identique : la majuscule automatique d'iPhone (« Supprimer ») ou une
 *       espace finale laissaient le bouton désactivé.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { EMPTY, of } from 'rxjs';
import { ProfileComponent } from './profile.component';
import { UserStore } from '../../core/stores/user.store';
import { AuthService } from '../../core/auth/auth.service';
import { BillingApi } from '../../core/api/billing.api';
import { UsersApi } from '../../core/api/users.api';
import { TradesApi } from '../../core/api/trades.api';
import { SetupsStore } from '../../core/stores/setups.store';
import { AnalyticsApi } from '../../core/api/analytics.api';
import { ToastService } from '../../core/services/toast.service';

function mount(deleteMeImpl: () => unknown = () => of({}), extra: { updateMe?: () => unknown; forgot?: () => unknown; saveUserAssets?: () => unknown } = {}) {
  const auth = { currentUser: signal(null), setCurrentUser: vi.fn(), logout: vi.fn(), forgotPassword: vi.fn(extra.forgot ?? (() => of(undefined))) };
  const usersApi = {
    getAiUsage: vi.fn(() => of({ data: null })),
    deleteMe: vi.fn(deleteMeImpl),
    updateMe: vi.fn(extra.updateMe ?? (() => of({ data: {} }))),
  };
  const setups = { active: signal([]), archived: signal([]), load: vi.fn(), loaded: signal(true), remove: vi.fn(), archive: vi.fn(), restore: vi.fn(), create: vi.fn(), update: vi.fn() };
  const toast = { error: vi.fn(), success: vi.fn(), info: vi.fn() };

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: UserStore,
        useValue: {
          user: () => ({ email: 'a@b.c', name: 'Test', currency: 'EUR', notificationsEmail: true, debriefAutomatic: true, marketingConsent: false }),
          isPremium: () => false, isDemo: () => false, isInTrial: () => false,
          displayName: () => 'Test', startingCapital: () => 0, refreshUser: vi.fn(),
        },
      },
      { provide: AuthService, useValue: auth },
      // Offres (#525) : aucune, la section Abonnement reste celle d'avant.
      { provide: BillingApi, useValue: { offers: () => EMPTY } },
      { provide: UsersApi, useValue: usersApi },
      { provide: TradesApi, useValue: { getUserAssets: vi.fn(() => of({ data: [] })), saveUserAssets: vi.fn(extra.saveUserAssets ?? (() => of({}))) } },
      { provide: SetupsStore, useValue: setups },
      { provide: ToastService, useValue: toast },
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
  return { cmp: fixture.componentInstance as any, auth, usersApi, setups, toast };
}

beforeEach(() => TestBed.resetTestingModule());

describe('Profil — échecs expliqués', () => {
  it('suppression de setup refusée (« archive-le plutôt ») → message affiché', () => {
    const { cmp, setups, toast } = mount();
    cmp.deleteSetup('s1');
    const onError = setups.remove.mock.calls[0][1] as (m: string) => void;
    onError('Ce setup a déjà servi : archive-le plutôt.');
    expect(toast.error).toHaveBeenCalledWith('Ce setup a déjà servi : archive-le plutôt.');
  });

  it('archivage / restauration refusés → message affiché', () => {
    const { cmp, setups, toast } = mount();
    cmp.archiveSetup('s1');
    cmp.restoreSetup('s1');
    (setups.archive.mock.calls[0][1] as (m: string) => void)('Refus A');
    (setups.restore.mock.calls[0][1] as (m: string) => void)('Refus R');
    expect(toast.error).toHaveBeenCalledWith('Refus A');
    expect(toast.error).toHaveBeenCalledWith('Refus R');
  });

  it('nom non enregistré → message affiché', async () => {
    const { throwError } = await import('rxjs');
    const { cmp, toast } = mount(undefined, { updateMe: () => throwError(() => ({ status: 500 })) });
    cmp.nameInput.set('Nouveau nom');
    cmp.saveName();
    expect(toast.error).toHaveBeenCalled();
  });

  it('réinitialisation du mot de passe en échec → message affiché', async () => {
    const { throwError } = await import('rxjs');
    const { cmp, toast } = mount(undefined, { forgot: () => throwError(() => ({ status: 500 })) });
    cmp.resetPassword();
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('Profil — confirmation « SUPPRIMER » tolérante (F23)', () => {
  it.each(['SUPPRIMER', 'Supprimer', 'supprimer ', '  SUPPRIMER'])('« %s » accepté', (saisie) => {
    const { cmp } = mount();
    cmp.deleteInput.set(saisie);
    expect(cmp.deleteConfirmed()).toBe(true);
  });

  it.each(['', 'SUPPRIME', 'oui'])('« %s » refusé', (saisie) => {
    const { cmp } = mount();
    cmp.deleteInput.set(saisie);
    expect(cmp.deleteConfirmed()).toBe(false);
  });
});
