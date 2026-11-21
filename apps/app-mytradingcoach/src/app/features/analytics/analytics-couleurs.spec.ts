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
});
