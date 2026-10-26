// @vitest-environment node
/**
 * Styles de l'installation, verrouillés à leur source (jsdom ne calcule ni empilement ni couleur ;
 * un `.css?raw` est vide sous vitest, d'où `node:fs`).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
const sheet = read('./install-sheet.component.css');
const row = read('./install-settings.component.css');

/** z-index de la première règle `selector` qui en déclare un (même procédé que modal-layers.spec.ts). */
const zIndexOf = (css: string, selector: string): number => {
  let from = 0;
  for (;;) {
    const start = css.indexOf(selector, from);
    if (start === -1) throw new Error(`z-index introuvable pour ${selector}`);
    const m = css.slice(start, css.indexOf('}', start)).match(/z-index:\s*(\d+)/);
    if (m) return Number(m[1]);
    from = start + selector.length;
  }
};

describe('Feuille d’installation : paliers', () => {
  it('au-dessus des modales de page (1000) et du bouton menu, sous les toasts (« Lien copié » visible)', () => {
    const burger = zIndexOf(read('../../shared/components/sidebar/sidebar.component.css'), '.burger {');
    const toasts = Math.max(...[...read('../../shared/components/toasts/toasts.component.css').matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1])));
    const scrim = zIndexOf(sheet, '.is-scrim {');
    const box = zIndexOf(sheet, '.is-sheet, .is-banner {');
    expect(scrim).toBeGreaterThan(1000);
    expect(scrim).toBeGreaterThan(burger);
    expect(box).toBeGreaterThan(scrim);
    expect(box).toBeLessThan(toasts);
  });
});

describe('Installation : couleurs de theme.css uniquement', () => {
  it.each([['feuille', sheet], ['ligne du Profil', row]])('%s : aucune couleur en dur (sauf le blanc du bouton principal)', (_n, css) => {
    const hard = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)].map((m) => m[0]);
    expect(hard.filter((c) => c !== '#fff')).toEqual([]);
    // Le seul blanc : texte du bouton principal sur --primary (design.md).
    for (const m of css.matchAll(/#fff/g)) {
      const rule = css.slice(css.lastIndexOf('}', m.index) + 1, css.indexOf('}', m.index));
      expect(rule).toContain('var(--primary)');
    }
  });

  it('ligne du Profil : toute la largeur, aucun plafond', () => {
    expect(row).not.toMatch(/max-width/);
  });
});
