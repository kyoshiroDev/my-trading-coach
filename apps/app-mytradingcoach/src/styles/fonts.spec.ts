// @vitest-environment node
/**
 * Polices de l'app (styles/fonts.css, généré) : chaque famille et graisse chargée garde ses
 * sous-ensembles latin et latin-ext, et rien d'autre (budget du bundle, 2026-10-26). Une police
 * retirée, un fichier absent ou un caractère du français hors des plages fait échouer le test.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = __dirname;
const css = readFileSync(join(dir, 'fonts.css'), 'utf8');
const styles = readFileSync(join(dir, '..', 'styles.css'), 'utf8');

const FONTS: [string, string, number[]][] = [
  ['Space Grotesk', 'space-grotesk', [500, 600, 700]],
  ['Inter', 'inter', [400, 500, 600, 700, 800]],
  ['JetBrains Mono', 'jetbrains-mono', [400, 500, 600]],
];
// Caractères des textes de l'app : accents, ligatures, euro, point médian, guillemets, apostrophe.
const FRANCAIS = 'àâäçéèêëîïôöùûüÿÀÂÇÉÈÊËÎÏÔÙÛœŒ€·«»’…';

const blocks = [...css.matchAll(/\/\* ([a-z-]+)-(latin(?:-ext)?)-(\d+)-normal \*\/\s*@font-face \{([^}]*)\}/g)].map((m) => ({
  pkg: m[1], subset: m[2], weight: Number(m[3]), body: m[4],
}));

function ranges(body: string): [number, number][] {
  const r = /unicode-range:\s*([^;]+);/.exec(body)?.[1] ?? '';
  return r.split(',').map((p) => {
    const [a, b] = p.trim().replace(/^U\+/, '').split('-');
    return [parseInt(a, 16), parseInt(b ?? a, 16)];
  });
}

describe('Polices de l’app : latin et latin-ext seulement', () => {
  it('styles.css charge fonts.css, plus aucune feuille @fontsource complète', () => {
    expect(styles).toContain("@import url('./styles/fonts.css');");
    expect(styles).not.toMatch(/@fontsource\//);
  });

  it.each(FONTS)('%s : latin et latin-ext pour chaque graisse, avec la bonne famille', (family, pkg, weights) => {
    for (const w of weights) {
      for (const subset of ['latin', 'latin-ext']) {
        const b = blocks.find((x) => x.pkg === pkg && x.subset === subset && x.weight === w);
        expect(b, `${pkg} ${subset} ${w}`).toBeDefined();
        expect(b!.body).toContain(`font-family: '${family}'`);
        expect(b!.body).toContain(`font-weight: ${w}`);
      }
    }
  });

  it('aucun autre sous-ensemble (cyrillique, grec, vietnamien) ni autre graisse', () => {
    expect(css).not.toMatch(/cyrillic|greek|vietnamese/);
    expect(blocks).toHaveLength(FONTS.reduce((n, [, , w]) => n + w.length * 2, 0));
    expect((css.match(/@font-face/g) ?? []).length).toBe(blocks.length);
  });

  it('chaque fichier de police référencé existe', () => {
    for (const m of css.matchAll(/url\(([^)]+\.woff2?)\)/g)) {
      expect(existsSync(resolve(dir, m[1])), m[1]).toBe(true);
    }
  });

  it('les caractères du français sont couverts par le bloc latin de chaque police', () => {
    for (const b of blocks.filter((x) => x.subset === 'latin')) {
      const r = ranges(b.body);
      for (const ch of FRANCAIS) {
        const cp = ch.codePointAt(0)!;
        expect(r.some(([lo, hi]) => cp >= lo && cp <= hi), `${b.pkg} ${b.weight} : ${ch}`).toBe(true);
      }
    }
  });
});
