// @vitest-environment node
/**
 * Conformité des news en séance (suite de #881, comme eco-calendar.compliance.spec.ts) : la
 * carte de news n'affiche aucune tonalité de marché. Le sentiment fourni par la source de news
 * reste dans l'API, mais l'écran ne montre ni « Bull » / « Bear », ni flèche de direction.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|\/\/.*$/gm, '');
const ts = strip(readFileSync(join(__dirname, 'live-news.component.ts'), 'utf8'));
const css = strip(readFileSync(join(__dirname, 'live-news.component.css'), 'utf8'));

describe('News en séance · conformité des libellés', () => {
  it('aucun libellé ni flèche de direction de marché dans le gabarit', () => {
    expect(ts).not.toMatch(/\bbull\b|\bbear\b|haussi|baissi|▲|▼/i);
  });

  it('le sentiment de la source n’est plus lu par le composant', () => {
    expect(ts).not.toMatch(/\.sentiment\b/);
    expect(css).not.toMatch(/news-sentiment/);
  });

  it('la source de la news reste affichée', () => {
    expect(ts).toMatch(/news\.site/);
  });
});
