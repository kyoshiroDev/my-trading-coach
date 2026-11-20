import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Conformité AMF des textes publics de la landing (suite de #881, sur le modèle de
// eco-calendar.compliance.spec.ts) : aucune direction de marché ni « conseil actionnable ».
// L'application a retiré le sentiment haussier/baissier du calendrier éco (#920) ; la landing
// ne doit pas le réannoncer. Les articles de blog (src/content) sont hors de cette garde.
const root = resolve(import.meta.dirname, '../../..');
const landing = resolve(root, 'apps/landing-mytradingcoach/src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'content' ? [] : files(p);
    return /\.(astro|ts|md|mdx|json)$/.test(name) ? [p] : [];
  });
}

const PROSCRIT = /\bbull\b|\bbear\b|\bbullish\b|\bbearish\b|haussi[eè]re?s?|baissi[eè]re?s?|conseil actionnable/i;

describe('Landing : conformité AMF des libellés (#881)', () => {
  const sources = files(landing).map((p) => ({ file: relative(landing, p), src: readFileSync(p, 'utf8') }));

  it('lit bien les sources de la landing', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it('aucun texte public ne donne de direction de marché ni de « conseil actionnable »', () => {
    const hits = sources.flatMap(({ file, src }) =>
      src.split('\n').flatMap((line, i) => (PROSCRIT.test(line) ? [`${file}:${i + 1}`] : [])),
    );
    expect(hits).toEqual([]);
  });
});
