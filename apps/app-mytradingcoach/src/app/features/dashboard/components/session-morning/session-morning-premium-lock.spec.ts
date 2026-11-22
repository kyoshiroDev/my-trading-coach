import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Séance du matin, compte gratuit (#1189) : les 2 aperçus Premium floutés étaient des blocs de
 * 40 et 28 px avec des styles inline, et la carte du cadenas (~120 px) débordait sur le récap
 * « Hier » et l'objectif 1. Ils passent par des classes du .css, assez hautes pour la carte.
 */
const dir = import.meta.dirname;
const html = readFileSync(join(dir, 'session-morning.component.html'), 'utf8');
const css = readFileSync(join(dir, 'session-morning.component.css'), 'utf8');

describe('session-morning · emplacements du cadenas Premium (#1189)', () => {
  it('2 cadenas, chacun dans un emplacement .pl-slot, avec l’entrée heading (pas title)', () => {
    const locks = html.match(/<mtc-premium-lock[\s\S]*?\/>/g) ?? [];
    expect(locks).toHaveLength(2);
    for (const l of locks) {
      expect(l).toContain('heading=');
      expect(l).not.toMatch(/\btitle=/);
    }
    expect(html.match(/class="[^"]*(?<![\w-])pl-slot(?![\w-])/g)).toHaveLength(2);
  });

  it('plus aucun style inline dans les aperçus floutés', () => {
    // Blocs .pl-slot jusqu'au cadenas inclus (le reste du template garde des styles inline légitimes).
    const slots = html.match(/<div class="[^"]*(?<![\w-])pl-slot(?![\w-])[^"]*">[\s\S]*?<mtc-premium-lock[\s\S]*?\/>/g) ?? [];
    expect(slots).toHaveLength(2);
    for (const b of slots) expect(b).not.toMatch(/\sstyle=|\[style/);
  });

  it('emplacement assez haut pour la carte (150 px)', () => {
    const bloc = css.match(/\.pl-slot\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(bloc).toMatch(/position:\s*relative/);
    expect(bloc).toMatch(/min-height:\s*150px/);
  });

  it('téléphone (conteneur ≤ 520 px) : emplacement à 170 px (carte mesurée à ~160 px à 360 px)', () => {
    const tel = css.match(/@container \(max-width: 520px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(tel).toMatch(/\.pl-slot\s*\{\s*min-height:\s*170px/);
  });
});
