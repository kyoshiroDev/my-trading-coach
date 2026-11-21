import { describe, it, expect } from 'vitest';
import TEMPLATE from './analytics.component.html?raw';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// CSS lu sur disque : l'import ?raw d'un .css renvoie une chaîne vide sous vitest.
const STYLES = readFileSync(join(import.meta.dirname, 'analytics.component.css'), 'utf8');

/**
 * #1174 : l'aperçu flouté du paywall (courbe de capital, drawdown, heatmap) écrivait ses couleurs en
 * dur (#10b981, #ef4444, #f59e0b). Elles passent par les variables du thème.
 */
describe('Statistiques — couleurs du thème', () => {
  it('aucune couleur hexadécimale écrite en dur dans le gabarit', () => {
    expect(TEMPLATE).not.toMatch(/#[0-9a-f]{6}\b/i);
  });

  it('aperçu du paywall : vert = gains, rouge = pertes, par les variables du thème', () => {
    expect(STYLES).toMatch(/\.pv-stop-gain\s*\{\s*stop-color:\s*var\(--green\)/);
    expect(STYLES).toMatch(/\.pv-stop-loss\s*\{\s*stop-color:\s*var\(--red\)/);
    expect(STYLES).toMatch(/\.pv-stroke-gain\s*\{\s*stroke:\s*var\(--green\)/);
    expect(STYLES).toMatch(/\.pv-stroke-loss\s*\{\s*stroke:\s*var\(--red\)/);
    expect(TEMPLATE).toContain("'var(--green)'");
  });

  /**
   * #1175 : le reste du CSS doublait les tokens en dur (hex sombres, rgba des -dim, replis de var(),
   * blanc sur --blue). #1178 : le bouton du paywall vit dans mtc-premium-lock ; il ne reste que
   * l'ombre noire, et plus de violet décoratif dans l'aperçu.
   */
  it('CSS : aucune couleur en dur hors ombre, aucun violet décoratif', () => {
    const css = STYLES.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
    expect(css.match(/rgba\([^)]*\)/g)).toEqual(['rgba(0,0,0,.2)']);
    expect(css).not.toMatch(/var\(--[a-z-]+,\s*#/i); // plus de repli en dur
    expect(css).not.toContain('--purple');
  });

  it('#1178 : blocs verrouillés par le composant partagé mtc-premium-lock', () => {
    expect(TEMPLATE.match(/<mtc-premium-lock /g)).toHaveLength(3);
    expect(TEMPLATE).not.toContain('locked-overlay');
    expect(STYLES).not.toContain('.locked-cta');
  });
});
