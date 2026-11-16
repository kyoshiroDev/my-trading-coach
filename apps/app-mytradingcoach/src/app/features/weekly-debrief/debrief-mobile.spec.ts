// @vitest-environment node
/**
 * F16 (#1047) : onglet d'un compte du débrief à 360 px, trois montants en mono 22 px insécables dans une
 * rangée flex sans retour à la ligne (`.stat-card` en `flex: 1` sans `min-width: 0`) et 30 px de
 * marge : la 3e carte était coupée à droite. Grille à colonnes compressibles, marge réduite sur mobile.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Un `.css?raw` est vide sous vitest : lecture du fichier (commentaires retirés).
const CSS = readFileSync(join(__dirname, 'debrief.component.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');

const rule = (selector: string, css = CSS) => {
  const i = css.indexOf(`${selector} {`);
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
};

describe('Débrief, cartes de stats sur mobile (F16 #1047)', () => {
  it('rangée en grille à colonnes compressibles, cartes sans largeur minimale imposée', () => {
    // Une colonne égale et compressible par carte (2 ou 3 cartes selon le compte).
    expect(rule('.stats-row')).toContain('grid-auto-flow: column');
    expect(rule('.stats-row')).toContain('grid-auto-columns: minmax(0, 1fr)');
    expect(rule('.stat-card')).toContain('min-width: 0');
  });

  it('sous 768 px : marge de page réduite et montants plus petits', () => {
    const mobile = CSS.slice(CSS.indexOf('@media (max-width: 768px)'));
    expect(rule('.content', mobile)).toContain('padding: 16px');
    expect(rule('.stat-value', mobile)).toContain('font-size: 18px');
  });
});
