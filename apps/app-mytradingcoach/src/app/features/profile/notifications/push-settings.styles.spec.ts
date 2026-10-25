import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// `?raw` rend une chaîne vide pour un .css sous vitest : lecture directe du fichier.
const CSS = readFileSync(join(__dirname, 'push-settings.component.css'), 'utf-8');
const noComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

describe('Section Notifications : mise en page (revue phase 2 I3, design.md « Mise en page »)', () => {
  it('toute la largeur : aucun plafond de largeur, aucune hauteur fixe, rien de coupé', () => {
    expect(noComments).not.toMatch(/max-width:\s*\d+(px|rem|em)/);
    expect(noComments).not.toMatch(/(^|[;{\s])height:\s*(\d{3,}px|\d+vh)/);
    expect(noComments).not.toMatch(/overflow(-x|-y)?:\s*(hidden|scroll|auto)/);
  });

  it('cartes en grille à colonnes automatiques', () => {
    expect(noComments).toMatch(/grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 420px\), 1fr\)\)/);
    // Aucune carte en pleine ligne dans la grille : elle garderait des colonnes vides à 2560 px.
    expect(noComments).not.toMatch(/grid-column: 1 \/ -1/);
  });

  it('ordre du clavier = ordre affiché (m1) : aucun order ni display: contents qui réordonne', () => {
    expect(noComments).not.toMatch(/(^|[;{\s])order:/);
    expect(noComments).not.toMatch(/display:\s*contents/);
  });

  it('badge Premium en violet, comme le cadenas Premium de l’app (m8)', () => {
    const i = noComments.indexOf('.pn-prem {');
    const rule = noComments.slice(i, noComments.indexOf('}', i));
    expect(rule).toMatch(/color: var\(--purple-bright\)/);
    expect(rule).toMatch(/background: var\(--purple-dim\)/);
    expect(rule).not.toMatch(/--badge-premium|--blue/);
  });

  it('chaque bloc de la grille commence par un petit titre : colonnes alignées en haut au bureau', () => {
    const tpl = readFileSync(join(__dirname, 'push-settings.component.html'), 'utf-8');
    const grid = tpl.slice(tpl.indexOf('<div class="pn-grid">'));
    for (const block of ['pn-o-status', 'pn-o-types', 'pn-o-quiet', 'pn-o-devices']) {
      const i = grid.indexOf(`<div class="${block}">`);
      expect(i, block).toBeGreaterThanOrEqual(0);
      expect(grid.slice(i).split('\n')[1].trim(), block).toMatch(/^<h3 class="pn-hd">/);
    }
    expect(grid).toContain('<h3 class="pn-hd">Cet appareil</h3>');
  });
});
