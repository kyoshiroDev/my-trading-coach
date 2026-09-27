/**
 * le setup sélectionné du wizard CSV se recale quand la liste change.
 *
 * Bug d'origine (Val) : `setupId` était fixé UNE fois au premier setup actif, avec
 * un garde `!this.setupId()` qui empêchait toute correction ultérieure. Supprimer
 * ce setup plus loin dans l'onboarding laissait un id fantôme dans le formulaire →
 * `<select>` vide, et surtout import entier rejeté en 400 par le back.
 *
 * On teste le composant réel (l'effet vit dans son constructeur), avec un
 * `SetupsStore` mocké dont la liste active est un signal mutable : c'est
 * exactement le scénario « la liste change sous les pieds du formulaire ».
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { CsvImportComponent } from './csv-import.component';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { SetupsStore } from '../../core/stores/setups.store';

interface TestSetup {
  id: string;
  title: string;
  color: string;
  description: string;
  archived: boolean;
  sortOrder: number;
}

function setup(title: string, sortOrder: number): TestSetup {
  return { id: `s${sortOrder}`, title, color: '#10b981', description: '', archived: false, sortOrder };
}

const BREAKOUT = setup('Breakout', 0);
const PULLBACK = setup('Pullback', 1);
const RANGE = setup('Range', 2);

function mount(initial: TestSetup[]) {
  const active = signal<TestSetup[]>(initial);
  const setupsStore = { active, load: vi.fn(), loaded: signal(true) };

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SetupsStore, useValue: setupsStore },
      {
        provide: SelectedAccountStore,
        useValue: {
          activeAccounts: signal([]),
          selectedAccountId: signal('all'),
          load: vi.fn(),
          loaded: signal(true),
        },
      },
    ],
  });
  // Template neutralisé : seul l'effet du constructeur nous intéresse ici, le
  // rendu complet tirerait lucide-icon et le CSS pour rien.
  TestBed.overrideComponent(CsvImportComponent, {
    set: {
      template: '<div></div>',
      imports: [],
      styleUrls: [],
      styleUrl: undefined as unknown as string,
      schemas: [NO_ERRORS_SCHEMA],
    },
  });

  const fixture = TestBed.createComponent(CsvImportComponent);
  fixture.detectChanges();

  return { fixture, active, cmp: fixture.componentInstance as any };
}

describe('CsvImportComponent — resync du setup sélectionné', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('sélectionne le premier setup actif au montage', () => {
    const { cmp } = mount([BREAKOUT, PULLBACK, RANGE]);
    expect(cmp.setupId()).toBe(BREAKOUT.id);
  });

  it('le setup courant supprimé → recale sur un setup encore valide (bug Val)', () => {
    const { fixture, active, cmp } = mount([BREAKOUT, PULLBACK, RANGE]);
    expect(cmp.setupId()).toBe(BREAKOUT.id);

    // L'utilisateur supprime le setup présélectionné à l'étape « Tes setups ».
    active.set([PULLBACK, RANGE]);
    fixture.detectChanges();

    expect(
      cmp.setupId(),
      'setupId est resté sur un id fantôme : le back rejetterait tout l\'import',
    ).toBe(PULLBACK.id);
  });

  it('un choix utilisateur encore valide n\'est jamais écrasé', () => {
    const { fixture, active, cmp } = mount([BREAKOUT, PULLBACK, RANGE]);

    cmp.setupId.set(RANGE.id); // choix explicite dans le <select>
    // Une autre modification de la liste ne doit pas ramener au premier setup.
    active.set([BREAKOUT, RANGE]);
    fixture.detectChanges();

    expect(cmp.setupId()).toBe(RANGE.id);
  });

  it('plus aucun setup actif → sélection vide (rien n\'est envoyé au back)', () => {
    const { fixture, active, cmp } = mount([BREAKOUT]);

    active.set([]);
    fixture.detectChanges();

    expect(cmp.setupId()).toBe('');
  });

  it('la liste arrive après le montage (chargement asynchrone) → sélection posée', () => {
    const { fixture, active, cmp } = mount([]);
    expect(cmp.setupId()).toBe('');

    active.set([BREAKOUT, PULLBACK]);
    fixture.detectChanges();

    expect(cmp.setupId()).toBe(BREAKOUT.id);
  });
});
