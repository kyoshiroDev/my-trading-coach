/**
 * PROMPT-198 — réduire les frictions qui bloquent l'activation.
 *
 * Le wizard imposait 6 écrans obligatoires avant tout accès au produit, dont deux murs
 * coûteux : le capital de départ (info d'argent, exigée en 3ᵉ position à quelqu'un qui
 * n'a rien vu) et une description de stratégie d'au moins 15 caractères (seule étape
 * demandant de rédiger). Aucune sortie de secours.
 *
 * Ces tests verrouillent le NON-BLOCAGE. Ils sont écrits pour échouer si quelqu'un
 * réintroduit une contrainte : c'est le genre de garde-fou qu'un refactor lève sans y
 * penser, et la régression serait invisible (le wizard « marche » toujours).
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import * as angularCore from '@angular/core';
import { of } from 'rxjs';
import { OnboardingComponent } from './onboarding.component';
import { UsersApi } from '../../core/api/users.api';
import { TradesApi } from '../../core/api/trades.api';
import { TradesStore } from '../../core/stores/trades.store';
import { AuthService } from '../../core/auth/auth.service';
import { SetupsStore } from '../../core/stores/setups.store';

const resolveComponentResources = (angularCore as Record<string, unknown>)[
  'ɵresolveComponentResources'
] as (resolver: (url: string) => Promise<{ text(): Promise<string> }>) => Promise<void>;

beforeAll(async () => {
  await resolveComponentResources(() =>
    Promise.resolve({ text: () => Promise.resolve('') } as unknown as Response),
  );
});

const mockUsersApi = {
  saveOnboardingProfile: vi.fn().mockReturnValue(of({ data: { onboardingCompleted: false } })),
  finishOnboarding: vi.fn().mockReturnValue(of({ data: { onboardingCompleted: true } })),
};
const mockSetupsStore = {
  load: vi.fn(),
  active: () => [
    { id: 's1', title: 'Breakout', color: '#22c55e', description: '', archived: false, sortOrder: 0 },
  ],
  create: vi.fn(),
  remove: vi.fn(),
};
const authUser = signal<unknown>(null);

async function mount() {
  TestBed.configureTestingModule({
    imports: [OnboardingComponent],
    providers: [
      { provide: UsersApi, useValue: mockUsersApi },
      { provide: TradesApi, useValue: { create: vi.fn().mockReturnValue(of({})), saveUserAssets: vi.fn().mockReturnValue(of({ data: null })) } },
      { provide: TradesStore, useValue: { loadTrades: vi.fn() } },
      { provide: SetupsStore, useValue: mockSetupsStore },
      {
        provide: AuthService,
        useValue: { currentUser: authUser, setCurrentUser: vi.fn((u: unknown) => authUser.set(u)) },
      },
    ],
    schemas: [NO_ERRORS_SCHEMA],
  });
  TestBed.overrideComponent(OnboardingComponent, {
    set: {
      template: '<div></div>', styleUrls: [],
      styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA],
    },
  });
  await TestBed.compileComponents();
  const fixture = TestBed.createComponent(OnboardingComponent);
  fixture.detectChanges();
  return fixture.componentInstance as any;
}

describe('Onboarding — le capital de départ ne bloque plus', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  it('le champ est pré-rempli avec une valeur exploitable', async () => {
    const c = await mount();
    // Laisser le champ vide ferait cascader un « CAPITAL $0.00 » (startingCapital
    // vaut 0 par défaut en base, et le compte créé au 1er trade en hérite).
    expect(Number(c.capitalInput())).toBeGreaterThan(0);
  });

  it('un capital vidé n\'écrase pas la valeur en base', async () => {
    const c = await mount();
    c.selectedStyle.set('DAY_TRADING');
    c.selectedSessions.set(['LONDON']);
    c.capitalInput.set('');
    c.step.set(5);

    c.nextStep(); // étape stratégie → sauvegarde du profil

    const sent = mockUsersApi.saveOnboardingProfile.mock.calls[0][0];
    expect(
      sent.startingCapital,
      'Envoyer 0 écraserait le capital existant : le back ne réécrit que si non-null',
    ).toBeUndefined();
  });

  it('un capital saisi est bien transmis (non-régression)', async () => {
    const c = await mount();
    c.selectedStyle.set('DAY_TRADING');
    c.selectedSessions.set(['LONDON']);
    c.capitalInput.set('7500');
    c.step.set(5);

    c.nextStep();

    expect(mockUsersApi.saveOnboardingProfile.mock.calls[0][0].startingCapital).toBe(7500);
  });
});
describe('Onboarding — la description de stratégie est optionnelle', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  it('style + session suffisent, sans un mot de description', async () => {
    const c = await mount();
    c.selectedStyle.set('DAY_TRADING');
    c.selectedSessions.set(['LONDON']);
    c.strategyDescription.set('');

    expect(
      c.strategyValid(),
      'La description redevient obligatoire : c\'est le décrochage le plus probable',
    ).toBe(true);
  });

  it('une description courte passe aussi (plus de minimum de 15 caractères)', async () => {
    const c = await mount();
    c.selectedStyle.set('DAY_TRADING');
    c.selectedSessions.set(['NEW_YORK']);
    c.strategyDescription.set('Stop.');

    expect(c.strategyValid()).toBe(true);
  });

  it('style ou session manquants → toujours bloqué (on ne vide pas l\'étape)', async () => {
    const c = await mount();

    c.selectedStyle.set(null);
    c.selectedSessions.set(['LONDON']);
    expect(c.strategyValid()).toBe(false);

    c.selectedStyle.set('DAY_TRADING');
    c.selectedSessions.set([]);
    expect(c.strategyValid()).toBe(false);
  });

  it('la description reste envoyée quand elle est remplie', async () => {
    const c = await mount();
    c.selectedStyle.set('SCALPING');
    c.selectedSessions.set(['LONDON']);
    c.strategyDescription.set('Je respecte mon stop.');
    c.step.set(5);

    c.nextStep();

    expect(mockUsersApi.saveOnboardingProfile.mock.calls[0][0].strategyDescription).toBe(
      'Je respecte mon stop.',
    );
  });
});
