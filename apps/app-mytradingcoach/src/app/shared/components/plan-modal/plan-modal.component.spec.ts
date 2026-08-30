import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import * as angularCore from '@angular/core';
import { of } from 'rxjs';
import { PlanModalComponent } from './plan-modal.component';
import { BillingApi } from '../../../core/api/billing.api';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const resolveComponentResources = (
  angularCore as Record<string, unknown>
)['ɵresolveComponentResources'] as (
  resolver: (url: string) => Promise<{ text(): Promise<string> }>,
) => Promise<void>;

const stubResolver = () =>
  Promise.resolve({ text: () => Promise.resolve('') } as unknown as Response);

beforeAll(async () => {
  await resolveComponentResources(stubResolver);
});

const mockBillingApi = {
  checkout: vi
    .fn()
    .mockReturnValue(of({ data: { url: 'https://checkout.stripe.com/test' } })),
};

describe('PlanModalComponent', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockBillingApi.checkout.mockReturnValue(
      of({ data: { url: 'https://checkout.stripe.com/test' } }),
    );

    TestBed.configureTestingModule({
      imports: [PlanModalComponent],
      providers: [{ provide: BillingApi, useValue: mockBillingApi }],
      schemas: [NO_ERRORS_SCHEMA],
    });
    TestBed.overrideComponent(PlanModalComponent, {
      set: {
        template: '<div></div>',
        styleUrls: [],
        styleUrl: undefined as unknown as string,
      },
    });
    await TestBed.compileComponents();
  });

  type ModalApi = {
    interval: () => string;
    setInterval: (i: string) => void;
    planId: () => string;
    confirmPlan: () => void;
    close: () => void;
  };
  const instance = (): ModalApi => {
    const fixture = TestBed.createComponent(PlanModalComponent);
    fixture.detectChanges();
    return fixture.componentInstance as unknown as ModalApi;
  };

  it('par défaut: palier premium + intervalle mensuel', () => {
    const c = instance();
    expect(c.interval()).toBe('monthly');
    expect(c.planId()).toBe('premium_monthly');
  });

  it('setInterval() change l’intervalle (annuel)', () => {
    const c = instance();
    c.setInterval('yearly');
    expect(c.interval()).toBe('yearly');
    expect(c.planId()).toBe('premium_yearly');
  });

  it('planId() recompose premium_interval', () => {
    const c = instance();
    c.setInterval('monthly');
    expect(c.planId()).toBe('premium_monthly');
  });

  it("close() émet l'output closed", () => {
    const fixture = TestBed.createComponent(PlanModalComponent);
    fixture.detectChanges();
    const closedSpy = vi.fn();
    fixture.componentInstance.closed.subscribe(closedSpy);
    (fixture.componentInstance as unknown as ModalApi).close();
    expect(closedSpy).toHaveBeenCalledOnce();
  });

  it('confirmPlan() appelle checkout avec le planId composé (annuel)', () => {
    const c = instance();
    c.setInterval('yearly');
    c.confirmPlan();
    expect(mockBillingApi.checkout).toHaveBeenCalledWith('premium_yearly');
  });

  it('confirmPlan() par défaut → checkout("premium_monthly")', () => {
    const c = instance();
    c.confirmPlan();
    expect(mockBillingApi.checkout).toHaveBeenCalledWith('premium_monthly');
  });
});

/**
 * PROMPT-202 — reliquat du layout à 2 paliers.
 *
 * Le palier STARTER a été supprimé au PROMPT-169, mais le CSS avait gardé
 * `grid-template-columns: 1fr 1fr` et `max-width: 620px`. La seule colonne restante se
 * retrouvait collée à gauche d'une grille pensée pour deux, avec un grand vide à droite
 * — le « ça fait pas pro » remonté par Greg.
 *
 * jsdom ne calcule aucun layout : ni la grille, ni un débordement mobile ne sont
 * observables par un test de rendu. Les invariants sont donc lus à la source, ce qui
 * échoue si la grille ou la largeur reviennent. Le reste est vérifié dans le DOM.
 */
describe('PlanModalComponent — palier unique, plus de grille 2 colonnes', () => {
  const css = () =>
    readFileSync(join(__dirname, 'plan-modal.component.css'), 'utf-8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
  const html = () =>
    readFileSync(join(__dirname, 'plan-modal.component.html'), 'utf-8');

  it('la carte est dimensionnée pour une seule colonne', () => {
    // `.plan-modal-card` apparaît DEUX fois (règle de base + override). Ne lire que la
    // première laissait passer un override à 620px — piège rencontré en écrivant ce
    // test. On vérifie donc TOUTES les déclarations, y compris la dernière, qui gagne.
    const largeurs = [...css().matchAll(/\.plan-modal-card\s*\{[^}]*?max-width:\s*(\d+)px/g)]
      .map((m) => Number(m[1]));

    expect(largeurs.length, 'Aucun max-width sur .plan-modal-card').toBeGreaterThan(0);
    expect(
      Math.max(...largeurs),
      `Largeur héritée des 2 paliers (${largeurs.join(', ')}) : la colonne unique flotte à gauche`,
    ).toBeLessThanOrEqual(440);
  });

  it('plus aucune grille à deux colonnes', () => {
    expect(css()).not.toMatch(/grid-template-columns:\s*1fr\s+1fr/);
  });

  it('le wrapper de grille a disparu du HTML et du CSS', () => {
    expect(html()).not.toContain('plan-cols');
    expect(css()).not.toContain('plan-cols');
  });

  it('les règles mortes du système à 2 paliers sont supprimées', () => {
    // Vérifiées une par une comme inutilisées avant suppression : aucune n'était
    // référencée par un HTML ou un TS. Les styles sont scopés au composant, donc les
    // 6 autres pages qui ouvrent la modale ne pouvaient pas les réutiliser.
    const c = css();
    for (const mortes of [
      'plan-modal-options', 'plan-option', 'plan-col-check',
      'plan-col-intervals', 'plan-interval-btn', 'feat-no', 'feat-upsell',
    ]) {
      expect(c, `Règle morte encore présente : ${mortes}`).not.toContain(mortes);
    }
  });

  it('le badge Premium reste à cheval sur la bordure haute', () => {
    expect(css()).toMatch(/\.plan-col-badge\s*\{[^}]*top:\s*-11px/);
  });

  it('les glyphes texte ont laissé place aux icônes lucide', () => {
    const h = html();
    for (const glyphe of ['✓', '✕', '⚡']) {
      expect(h, `Glyphe ${glyphe} encore présent`).not.toContain(glyphe);
    }
    // 8 features + fermeture + éclair du titre.
    expect((h.match(/<lucide-icon/g) ?? []).length).toBe(10);
  });
});
