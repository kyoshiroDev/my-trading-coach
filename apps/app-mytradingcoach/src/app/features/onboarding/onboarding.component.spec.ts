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
import { UserStore } from '../../core/stores/user.store';
import { SetupsStore } from '../../core/stores/setups.store';

const resolveComponentResources = (angularCore as Record<string, unknown>)[
  'ɵresolveComponentResources'
] as (resolver: (url: string) => Promise<{ text(): Promise<string> }>) => Promise<void>;

const stubResolver = () =>
  Promise.resolve({ text: () => Promise.resolve('') } as unknown as Response);

beforeAll(async () => {
  await resolveComponentResources(stubResolver);
});

const mockUsersApi = {
  // Sauvegarde du profil : ne termine PAS l'onboarding (flag reste false)
  saveOnboardingProfile: vi
    .fn()
    .mockReturnValue(of({ data: { onboardingCompleted: false } })),
  finishOnboarding: vi
    .fn()
    .mockReturnValue(of({ data: { onboardingCompleted: true } })),
};
const mockTradesApi = {
  create: vi.fn().mockReturnValue(of({})),
  saveUserAssets: vi.fn().mockReturnValue(of({ data: null })),
};
const mockTradesStore = { loadTrades: vi.fn() };
const mockSetupsStore = {
  load: vi.fn(),
  // ≥2 setups actifs : le garde-fou « garder au moins un » ne bloque pas removeSetup,
  // et aucun ne s'appelle « ORB » → l'anti-doublon laisse passer la création.
  active: () => [
    { id: 's1', title: 'Breakout', color: '#22c55e', description: '', archived: false, sortOrder: 0 },
    { id: 's2', title: 'Range', color: '#f59e0b', description: '', archived: false, sortOrder: 1 },
  ],
  create: vi.fn(),
  remove: vi.fn(),
};
const authUser = signal<unknown>(null);
const mockAuth = {
  currentUser: authUser,
  setCurrentUser: vi.fn((u: unknown) => authUser.set(u)),
};

// Minimal template exercising the DOM assertions in the tests below
const MINIMAL_TEMPLATE = `
  @if (step() === 1) {
    <div>Quel marché trades-tu ?</div>
    <button class="btn-next" [disabled]="!selectedMarket()">Continuer</button>
  }
  @if (step() === 2) {
    <div>ton objectif principal de progression</div>
    <button class="btn-next" [disabled]="!selectedGoal()">Continuer</button>
  }
  @if (step() > 2) {
    <div>step {{ step() }}</div>
  }
  @if (step() === 9 && importSummary(); as imp) {
    <div data-testid="onboarding-import-recap">{{ imp.created }} importés</div>
    @if (imp.feesImported; as f) {
      @if (f.merged === false) { <div data-testid="onboarding-import-fees-warning">frais non rapprochés</div> }
    } @else {
      <div data-testid="onboarding-import-fees-warning">frais non importés</div>
    }
  }
`;

describe('OnboardingComponent', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Le wizard persiste sa progression : sans purge, un test
    // reprendrait l'étape laissée par le précédent.
    localStorage.clear();

    TestBed.configureTestingModule({
      imports: [OnboardingComponent],
      providers: [
        { provide: UsersApi, useValue: mockUsersApi },
        { provide: TradesApi, useValue: mockTradesApi },
        { provide: TradesStore, useValue: mockTradesStore },
        { provide: SetupsStore, useValue: mockSetupsStore },
        { provide: AuthService, useValue: mockAuth },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    TestBed.overrideComponent(OnboardingComponent, {
      set: {
        template: MINIMAL_TEMPLATE,
        styleUrls: [],
        styleUrl: undefined as unknown as string,
        schemas: [NO_ERRORS_SCHEMA],
      },
    });
    await TestBed.compileComponents();
  });

  it('affiche le wizard a la step 1 par defaut', () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Quel marché');
  });

  it('le bouton Continuer est desactive sans selection de marche', () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.btn-next') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('le bouton Continuer s active apres selection de marche', () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance as unknown as { selectMarket: (m: string) => void };
    c.selectMarket('CRYPTO');
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.btn-next') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('passe a step 2 apres nextStep()', () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance as unknown as {
      selectMarket: (m: string) => void;
      nextStep: () => void;
    };
    c.selectMarket('CRYPTO');
    c.nextStep();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('objectif principal');
  });

  it('le bouton Continuer est desactive a step 2 sans selection objectif', () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance as unknown as {
      selectMarket: (m: string) => void;
      nextStep: () => void;
    };
    c.selectMarket('CRYPTO');
    c.nextStep();
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.btn-next') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('atteint step 3 apres selection marche + objectif', () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance as unknown as {
      selectMarket: (m: string) => void;
      selectGoal: (g: string) => void;
      nextStep: () => void;
      step: () => number;
    };
    c.selectMarket('CRYPTO');
    c.nextStep();
    fixture.detectChanges();
    c.selectGoal('DISCIPLINE');
    c.nextStep();
    expect(c.step()).toBe(3);
  });

  it("la sauvegarde de la stratégie ne termine PAS l'onboarding (étape Actifs atteignable)", () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();

    let completedEmitted = false;
    fixture.componentInstance.completed.subscribe(() => (completedEmitted = true));

    const c = fixture.componentInstance as unknown as {
      saveProfileThenGoAssets: () => void;
      step: () => number;
    };
    c.saveProfileThenGoAssets();

    expect(mockUsersApi.saveOnboardingProfile).toHaveBeenCalled();
    // L'onboarding ne doit pas se terminer à l'étape stratégie
    expect(mockUsersApi.finishOnboarding).not.toHaveBeenCalled();
    expect(completedEmitted).toBe(false);
    // On avance vers l'étape Actifs (6), pas vers le dashboard
    expect(c.step()).toBe(6);
  });

  it("le flag de fin n'est posé qu'à l'écran final (completed émis au step 9)", () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();

    let completedEmitted = false;
    fixture.componentInstance.completed.subscribe(() => (completedEmitted = true));

    const c = fixture.componentInstance as unknown as {
      finishAndGoDiscord: () => void;
      step: () => number;
    };
    // « Je commence à zéro » → étape finale (9), pas encore de completed
    c.finishAndGoDiscord();
    expect(c.step()).toBe(9);
    expect(completedEmitted).toBe(false);
  });

  it('étape premier trade : les 3 options (CSV / manuel / zéro) sont distinctes et câblées', () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance as unknown as {
      tradeChoice: () => string;
      csvOpen: () => boolean;
      step: () => number;
      chooseCsv: () => void;
      chooseManual: () => void;
      finishAndGoDiscord: () => void;
    };

    // CSV → ouvre l'import
    c.chooseCsv();
    expect(c.tradeChoice()).toBe('csv');
    expect(c.csvOpen()).toBe(true);

    // Manuel → bascule sur le formulaire
    c.chooseManual();
    expect(c.tradeChoice()).toBe('manual');

    // Zéro → saute directement à l'étape finale (Discord)
    c.finishAndGoDiscord();
    expect(c.step()).toBe(9);
  });

  it('étape Tes setups : charge le store, ajoute/retire via le store, wizard à 9 étapes', () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();
    expect(mockSetupsStore.load).toHaveBeenCalled();

    const c = fixture.componentInstance as unknown as {
      step: { set: (n: number) => void };
      progress: number;
      stepLabel: string;
      showSetupModal: { (): boolean; set: (v: boolean) => void };
      openSetupModal: () => void;
      onSetupSave: (v: { title: string; color: string; description: string }) => void;
      removeSetup: (id: string) => void;
    };

    // Wizard 9 écrans, 7 étapes annoncées : la barre suit le libellé, pas le nombre
    // d'écrans. L'assertion porte sur l'intention, pas sur la formule.
    c.step.set(7);
    expect(c.stepLabel).toBe('Étape 6 sur 7');
    expect(c.progress).toBe(Math.round((6 / 7) * 100));
    c.step.set(8);
    expect(c.stepLabel).toBe('Étape 7 sur 7');
    expect(
      c.progress,
      'Dernière étape annoncée : la barre doit être pleine, pas à 89 %',
    ).toBe(100);
    c.step.set(9);
    expect(c.progress).toBe(100);

    // Ajout via la modale partagée → store.create + ferme la modale.
    c.openSetupModal();
    expect(c.showSetupModal()).toBe(true);
    c.onSetupSave({ title: 'ORB', color: '#22d3ee', description: '' });
    expect(mockSetupsStore.create).toHaveBeenCalledWith(
      { title: 'ORB', color: '#22d3ee', description: '' },
      undefined,
      expect.any(Function),
    );
    expect(c.showSetupModal()).toBe(false);

    // Retrait → store.remove (avec callback d'erreur).
    c.removeSetup('s1');
    expect(mockSetupsStore.remove).toHaveBeenCalledWith('s1', expect.any(Function));
  });

  it("après sauvegarde des actifs, le store est à jour → pas de faux « Complète ton profil »", () => {
    // Profil complet SAUF les actifs (état avant l'étape 6)
    authUser.set({ tradingStyle: 'SCALPING', tradingStrategy: ['BREAKOUT'], tradingAssets: [], favoriteAsset: null });
    const userStore = TestBed.inject(UserStore);
    expect(userStore.profileIncomplete()).toBe(true); // sanity : faux positif possible avant le fix

    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance as unknown as {
      selectedAssets: { set: (v: string[]) => void };
      favoriteAsset: { set: (v: string) => void };
      saveAssetsThenGoTrade: () => void;
    };
    c.selectedAssets.set(['BTCUSDT']);
    c.favoriteAsset.set('BTCUSDT');
    c.saveAssetsThenGoTrade();

    // Le store reflète les actifs persistés → profileIncomplete() redevient faux.
    const u = authUser() as { tradingAssets?: string[]; favoriteAsset?: string | null };
    expect(u.tradingAssets).toEqual(['BTCUSDT']);
    expect(u.favoriteAsset).toBe('BTCUSDT');
    expect(userStore.profileIncomplete()).toBe(false);
  });

  // la modale d'import se ferme aussitôt (step 9) : sans récapitulatif,
  // l'utilisateur terminait l'onboarding sans savoir si son historique était arrivé.
  describe("confirmation d'import à l'écran final", () => {
    function importer(result: unknown) {
      const fixture = TestBed.createComponent(OnboardingComponent);
      fixture.detectChanges();
      const c = fixture.componentInstance as unknown as { onCsvImported: (r: unknown) => void };
      c.onCsvImported(result);
      fixture.detectChanges();
      return fixture;
    }

    it('affiche le nombre de trades importés', () => {
      const fixture = importer({ created: 20, duplicates: 0, failed: 0, total: 20,
        feesImported: { assigned: 21.84, expected: 21.84, reconciled: true, count: 20 } });

      const recap = fixture.nativeElement.querySelector('[data-testid="onboarding-import-recap"]');
      expect(recap, "Le récapitulatif d'import doit être visible avant l'écran final").toBeTruthy();
      expect(recap.textContent).toContain('20');
      expect(fixture.nativeElement.querySelector('[data-testid="onboarding-import-fees-warning"]')).toBeFalsy();
    });

    it('relaie l\'avertissement « frais non rapprochés »', () => {
      const fixture = importer({ created: 20, duplicates: 0, failed: 0, total: 20,
        feesImported: { assigned: 0, expected: 0, reconciled: false, merged: false, count: 20 } });

      expect(
        fixture.nativeElement.querySelector('[data-testid="onboarding-import-fees-warning"]'),
        "L'avertissement frais était invisible dans le parcours onboarding",
      ).toBeTruthy();
    });

    it('import sans Cash history → rappel frais non importés (#7)', () => {
      const fixture = importer({ created: 20, duplicates: 0, failed: 0, total: 20 });

      expect(fixture.nativeElement.querySelector('[data-testid="onboarding-import-fees-warning"]')).toBeTruthy();
    });

    it('aucun import (saisie manuelle / skip) → pas de récapitulatif', () => {
      const fixture = TestBed.createComponent(OnboardingComponent);
      fixture.detectChanges();
      const c = fixture.componentInstance as unknown as { step: { set: (n: number) => void } };
      c.step.set(9);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="onboarding-import-recap"]')).toBeFalsy();
    });
  });
});

// un rechargement au milieu du wizard ne doit plus tout reperdre.
// Constat navigateur : reload après l'étape Capital → retour à l'étape 1, marché,
// objectif et capital à ressaisir (rien n'est persisté côté serveur avant l'étape 5).
describe('OnboardingComponent — reprise après rechargement', () => {
  const KEY = 'mtc.onboarding.progress';

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [OnboardingComponent],
      providers: [
        { provide: UsersApi, useValue: mockUsersApi },
        { provide: TradesApi, useValue: mockTradesApi },
        { provide: TradesStore, useValue: mockTradesStore },
        { provide: SetupsStore, useValue: mockSetupsStore },
        { provide: AuthService, useValue: mockAuth },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    TestBed.overrideComponent(OnboardingComponent, {
      set: { template: '<div></div>', styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
    });
    await TestBed.compileComponents();
  });

  function mount() {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();
    return { fixture, c: fixture.componentInstance as any };
  }

  it('reprend a l etape atteinte, avec les saisies (marche, objectif, capital)', () => {
    const first = mount();
    first.c.selectMarket('CRYPTO');
    first.c.selectGoal('DISCIPLINE');
    first.c.capitalInput.set('5000');
    first.c.step.set(5);
    first.fixture.detectChanges();

    // « Rechargement » : nouveau composant, même stockage local.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [OnboardingComponent],
      providers: [
        { provide: UsersApi, useValue: mockUsersApi },
        { provide: TradesApi, useValue: mockTradesApi },
        { provide: TradesStore, useValue: mockTradesStore },
        { provide: SetupsStore, useValue: mockSetupsStore },
        { provide: AuthService, useValue: mockAuth },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    TestBed.overrideComponent(OnboardingComponent, {
      set: { template: '<div></div>', styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
    });
    const again = mount();

    expect(again.c.step(), 'Le wizard doit reprendre a l etape atteinte, pas a 1').toBe(5);
    expect(again.c.selectedMarket()).toBe('CRYPTO');
    expect(again.c.selectedGoal()).toBe('DISCIPLINE');
    expect(again.c.capitalInput()).toBe('5000');
  });

  it('la fin de l onboarding purge la progression', () => {
    const { c } = mount();
    c.step.set(9);
    c.finish();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('snapshot illisible → repart proprement a l etape 1', () => {
    localStorage.setItem(KEY, '{ ceci nest pas du json');
    const { c } = mount();
    expect(c.step()).toBe(1);
  });

  it('etape hors bornes → ignoree', () => {
    localStorage.setItem(KEY, JSON.stringify({ step: 42, market: 'CRYPTO' }));
    const { c } = mount();
    expect(c.step()).toBe(1);
  });
});
