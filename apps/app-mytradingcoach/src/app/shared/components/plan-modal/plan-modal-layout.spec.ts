// @vitest-environment node
/**
 * Invariants de MISE EN PAGE de la modale Premium, lus dans les feuilles source.
 *
 * Fichier séparé et en environnement `node` : ces tests lisent le disque, ce que
 * l'environnement jsdom du reste de la suite ne permet pas (`node:fs` y est
 * externalisé). Les mélanger cassait `nx test` sans afficher le moindre résultat.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * reliquat du layout à 2 paliers.
 *
 * Le palier STARTER a été supprimé, mais le CSS avait gardé
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
    readFileSync(join(__dirname, 'plan-modal.component.css'), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
  const html = () => readFileSync(join(__dirname, 'plan-modal.component.html'), 'utf-8');

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

  it('les offres sont empilées sur une colonne (fondateur, code, Premium)', () => {
    expect(css()).toMatch(/\.offer-list\s*\{[^}]*flex-direction:\s*column/);
  });

  it('les glyphes texte ont laissé place aux icônes lucide', () => {
    const h = html();
    for (const glyphe of ['✓', '✕', '⚡']) {
      expect(h, `Glyphe ${glyphe} encore présent`).not.toContain(glyphe);
    }
    // « Tout le plan Gratuit » + la boucle des avantages (PLAN_BENEFITS) + fermeture + éclair du titre.
    expect((h.match(/\[lucideIcon\]/g) ?? []).length).toBe(4); // @lucide/angular : <svg [lucideIcon]>
  });
});

describe('PlanModalComponent — avantages Premium', () => {
  const html = () => readFileSync(join(__dirname, 'plan-modal.component.html'), 'utf-8');

  it('liste lue dans PLAN_BENEFITS (@mtc/shared), aucun avantage écrit en dur ni « crypto »', () => {
    const feats = html().slice(html().indexOf('plan-col-feats'), html().indexOf('</ul>', html().indexOf('plan-col-feats')));
    expect(feats).toContain('@for (b of premiumBenefits');
    expect(feats.match(/<li>/g)).toHaveLength(2); // « Tout le plan Gratuit inclus » + la boucle
    expect(html()).not.toMatch(/crypto/i);
  });
});
