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
import { of, throwError } from 'rxjs';
import { OnboardingComponent } from './onboarding.component';
import { UsersApi } from '../../core/api/users.api';
import { TradesApi } from '../../core/api/trades.api';
import { TradesStore } from '../../core/stores/trades.store';
import { AuthService } from '../../core/auth/auth.service';
import { SetupsStore } from '../../core/stores/setups.store';
import { AccountsApi } from '../../core/api/accounts.api';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
const mockAccountsApi = {
  getAll: vi.fn().mockReturnValue(of({ data: [] })),
  create: vi.fn().mockReturnValue(of({ data: { id: 'acc-1' } })),
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
      { provide: AccountsApi, useValue: mockAccountsApi },
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
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    // clearAllMocks efface aussi les valeurs de retour : les re-armer.
    mockAccountsApi.getAll.mockReturnValue(of({ data: [] }));
    mockAccountsApi.create.mockReturnValue(of({ data: { id: 'acc-1' } }));
    mockUsersApi.saveOnboardingProfile.mockReturnValue(of({ data: { onboardingCompleted: false } }));
  });

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
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    // clearAllMocks efface aussi les valeurs de retour : les re-armer.
    mockAccountsApi.getAll.mockReturnValue(of({ data: [] }));
    mockAccountsApi.create.mockReturnValue(of({ data: { id: 'acc-1' } }));
    mockUsersApi.saveOnboardingProfile.mockReturnValue(of({ data: { onboardingCompleted: false } }));
  });

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

describe('Onboarding — sortie de secours', () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    // clearAllMocks efface aussi les valeurs de retour : les re-armer.
    mockAccountsApi.getAll.mockReturnValue(of({ data: [] }));
    mockAccountsApi.create.mockReturnValue(of({ data: { id: 'acc-1' } }));
    mockUsersApi.saveOnboardingProfile.mockReturnValue(of({ data: { onboardingCompleted: false } }));
  });

  it('« passer » termine l\'onboarding et purge la progression', async () => {
    const c = await mount();
    const done = vi.fn();
    c.completed.subscribe(done);
    c.step.set(4);
    localStorage.setItem('mtc.onboarding.progress', '{"step":4}');

    c.skip();

    // `completed` est ce que la sidebar écoute pour fermer le wizard ET appeler
    // finishOnboarding : sans lui, le wizard se rouvrirait au prochain chargement.
    expect(done).toHaveBeenCalled();
    expect(
      Object.keys(localStorage).some((k) => k.includes('onboarding')),
      'Progression laissée derrière : le wizard rouvrirait sur l\'étape abandonnée',
    ).toBe(false);
  });
});

describe('Onboarding — barre de progression alignée sur le libellé', () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    // clearAllMocks efface aussi les valeurs de retour : les re-armer.
    mockAccountsApi.getAll.mockReturnValue(of({ data: [] }));
    mockAccountsApi.create.mockReturnValue(of({ data: { id: 'acc-1' } }));
    mockUsersApi.saveOnboardingProfile.mockReturnValue(of({ data: { onboardingCompleted: false } }));
  });

  it('la barre est pleine à l\'étape annoncée comme la dernière', async () => {
    const c = await mount();
    c.step.set(8);
    expect(c.stepLabel).toBe('Étape 7 sur 7');
    expect(c.progress).toBe(100);
  });

  it('l\'écran de promesse est à 0 % (ce n\'est pas une étape)', async () => {
    const c = await mount();
    c.step.set(1);
    expect(c.stepLabel).toBe('');
    expect(c.progress).toBe(0);
  });
});

/**
 * PROMPT-199 tâche 1 — la modale de setup doit passer AU-DESSUS du wizard.
 *
 * Le bouton « + Ajouter un setup » de l'étape Setups semblait ne rien faire : la modale
 * partagée s'ouvrait à z-index 200, sous l'overlay de l'onboarding à 300. Elle était
 * bien dans le DOM — c'est précisément pour ça qu'un test « présent dans le DOM »
 * n'aurait rien vu, et que le bug est passé.
 *
 * jsdom ne calcule aucun contexte d'empilement : aucun test de rendu ne peut constater
 * le recouvrement. On verrouille donc l'invariant à sa source, les deux feuilles de
 * style, ce qui échoue si l'un des deux nombres repasse du mauvais côté.
 */
describe('Modale de setup au-dessus du wizard (invariant de z-index)', () => {
  const read = (rel: string) =>
    readFileSync(join(__dirname, rel), 'utf-8');
  /**
   * Les commentaires sont retirés AVANT la recherche : ceux qui documentent ces règles
   * citent d'autres valeurs de z-index, qu'un parseur naïf capturerait à la place de la
   * déclaration réelle.
   */
  const zIndexOf = (css: string, selector: string): number => {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const start = clean.indexOf(selector);
    if (start === -1) throw new Error(`Règle ${selector} introuvable`);
    const block = clean.slice(start, clean.indexOf('}', start));
    const m = block.match(/z-index:\s*(\d+)/);
    if (!m) throw new Error(`z-index introuvable pour ${selector}`);
    return Number(m[1]);
  };

  it('la modale de setup est au-dessus de l\'overlay d\'onboarding', () => {
    const wizard = zIndexOf(read('./onboarding.component.css'), '.overlay {');
    const modal = zIndexOf(
      read('../../shared/components/setup-form-modal/setup-form-modal.component.css'),
      '.stp-ov {',
    );

    expect(
      modal,
      `Modale à ${modal}, wizard à ${wizard} : « + Ajouter un setup » rouvrirait une modale invisible`,
    ).toBeGreaterThan(wizard);
  });

  it('la modale reste sous les toasts globaux', () => {
    const modal = zIndexOf(
      read('../../shared/components/setup-form-modal/setup-form-modal.component.css'),
      '.stp-ov {',
    );
    // styles.css : 10000. Une modale au-dessus masquerait les messages d'erreur.
    expect(modal).toBeLessThan(10000);
  });

  it('le bouton « + Ajouter un setup » ouvre bien la modale', async () => {
    const c = await mount();
    c.step.set(7);
    expect(c.showSetupModal()).toBe(false);
    c.openSetupModal();
    expect(c.showSetupModal()).toBe(true);
  });
});

/**
 * PROMPT-199 tâche 2 — le compte de trading est déclaré à l'étape 3.
 *
 * Avant, le compte n'existait qu'au premier trade, créé par `ensureDefaultAccountId` :
 * toujours PERSONAL, libellé « Compte principal », sans broker ni règles. Un trader
 * prop firm — la cible principale — démarrait donc avec un compte faux, alors que
 * `TradingAccount` porte déjà type / broker / profitTarget / maxDrawdown / drawdownType.
 */
describe('Onboarding — compte perso vs prop firm', () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    // clearAllMocks efface aussi les valeurs de retour : les re-armer.
    mockAccountsApi.getAll.mockReturnValue(of({ data: [] }));
    mockAccountsApi.create.mockReturnValue(of({ data: { id: 'acc-1' } }));
    mockUsersApi.saveOnboardingProfile.mockReturnValue(of({ data: { onboardingCompleted: false } }));
  });

  it('mode perso → PERSONAL, aucun champ prop firm envoyé', async () => {
    const c = await mount();
    c.accountMode.set('PERSO');
    c.capitalInput.set('5000');
    // Renseignés puis mode perso : ils ne doivent PAS fuiter dans le payload.
    c.broker.set('Apex');
    c.profitTarget.set('3000');
    c.maxDrawdown.set('2500');

    const p = c.buildAccountPayload();

    expect(p.type).toBe('PERSONAL');
    expect(p.label).toBe('Compte principal');
    expect(p.accountSize).toBe(5000);
    expect(p.startingBalance).toBe(5000);
    expect(p.broker).toBeUndefined();
    expect(p.profitTarget).toBeUndefined();
    expect(p.maxDrawdown).toBeUndefined();
    expect(p.drawdownType).toBeUndefined();
  });

  it('mode prop firm → EVALUATION avec les règles saisies', async () => {
    const c = await mount();
    c.accountMode.set('PROPFIRM');
    c.capitalInput.set('50000');
    c.broker.set('Apex');
    c.profitTarget.set('3000');
    c.maxDrawdown.set('2500');
    c.drawdownType.set('TRAILING');

    const p = c.buildAccountPayload();

    expect(p.type).toBe('EVALUATION');
    expect(p.label).toBe('Apex #1');
    expect(p.broker).toBe('Apex');
    expect(p.accountSize).toBe(50000);
    expect(p.profitTarget).toBe(3000);
    expect(p.maxDrawdown).toBe(2500);
    expect(p.drawdownType).toBe('TRAILING');
  });

  it('prop firm sans règles renseignées → aucun champ vide envoyé', async () => {
    const c = await mount();
    c.accountMode.set('PROPFIRM');
    c.capitalInput.set('50000');

    const p = c.buildAccountPayload();

    expect(p.type).toBe('EVALUATION');
    // Sans broker, pas de « undefined #1 » : on retombe sur le libellé neutre.
    expect(p.label).toBe('Compte principal');
    // Envoyer 0 afficherait une barre d'objectif vide au lieu de masquer la carte.
    expect(p.profitTarget).toBeUndefined();
    expect(p.maxDrawdown).toBeUndefined();
    expect(p.drawdownType).toBeUndefined();
  });

  it('un objectif à 0 n\'est pas envoyé (0 n\'est pas une règle)', async () => {
    const c = await mount();
    c.accountMode.set('PROPFIRM');
    c.profitTarget.set('0');
    c.maxDrawdown.set('0');

    const p = c.buildAccountPayload();
    expect(p.profitTarget).toBeUndefined();
    expect(p.maxDrawdown).toBeUndefined();
  });
});

describe('Onboarding — le compte n\'est jamais créé deux fois', () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    // clearAllMocks efface aussi les valeurs de retour : les re-armer.
    mockAccountsApi.getAll.mockReturnValue(of({ data: [] }));
    mockAccountsApi.create.mockReturnValue(of({ data: { id: 'acc-1' } }));
    mockUsersApi.saveOnboardingProfile.mockReturnValue(of({ data: { onboardingCompleted: false } }));
  });

  /** Avance de l'étape Stratégie (5) vers Actifs (6) : c'est là que tout est persisté. */
  function goPastStrategy(c: any) {
    c.selectedStyle.set('DAY_TRADING');
    c.selectedSessions.set(['LONDON']);
    c.step.set(5);
    c.nextStep();
  }

  it('crée le compte au checkpoint quand le compte n\'en a aucun', async () => {
    mockAccountsApi.getAll.mockReturnValue(of({ data: [] }));
    const c = await mount();
    goPastStrategy(c);

    expect(mockAccountsApi.getAll).toHaveBeenCalledTimes(1);
    expect(mockAccountsApi.create).toHaveBeenCalledTimes(1);
  });

  it('retour étape 6 → 5 puis ré-avance : PAS de 2e compte', async () => {
    mockAccountsApi.getAll.mockReturnValue(of({ data: [] }));
    const c = await mount();

    goPastStrategy(c);                 // 1er passage : création
    expect(mockAccountsApi.create).toHaveBeenCalledTimes(1);

    c.prevStep();                      // Actifs (6) → Stratégie (5)
    c.nextStep();                      // ré-avance : le checkpoint se rejoue

    expect(
      mockAccountsApi.create,
      'Un aller-retour dans le wizard a créé un second compte',
    ).toHaveBeenCalledTimes(1);
  });

  it('un compte existant côté serveur → aucune création', async () => {
    // Filet indépendant du client : rechargement, localStorage vidé, autre onglet.
    mockAccountsApi.getAll.mockReturnValue(of({ data: [{ id: 'acc-1' }] }));
    const c = await mount();
    goPastStrategy(c);

    expect(mockAccountsApi.getAll).toHaveBeenCalledTimes(1);
    expect(mockAccountsApi.create).not.toHaveBeenCalled();
  });

  it('un échec de création ne bloque pas l\'onboarding et reste rejouable', async () => {
    mockAccountsApi.getAll.mockReturnValue(of({ data: [] }));
    mockAccountsApi.create.mockReturnValueOnce(throwError(() => new Error('boom')));
    const c = await mount();

    goPastStrategy(c);
    expect(c.step()).toBe(6); // le parcours continue malgré l'échec

    mockAccountsApi.create.mockReturnValue(of({ data: { id: 'acc-1' } }));
    c.prevStep();
    c.nextStep();
    expect(mockAccountsApi.create).toHaveBeenCalledTimes(2);
  });
});
