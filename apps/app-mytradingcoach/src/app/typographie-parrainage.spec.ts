// @vitest-environment node
/**
 * Typographie française des pages Parrainage, Ambassadeur et Devenir ambassadeur : espace insécable
 * (U+00A0, `&nbsp;` dans les gabarits) avant « : », « ; », « ! », « ? » et « % ». Corrigé le
 * 25/10/2026 sans changer aucun mot (textes de commission et de parrainage, correction validée).
 *
 * Lu dans les gabarits sources : texte visible seulement (balises, attributs, commentaires et
 * interpolations `{{ }}` retirés). Le texte d'une balise <b>/<em> se recolle à son voisin, donc
 * « <b>Statut pro</b> : » est bien vu comme « Statut pro : ».
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGES = [
  'features/ambassador/ambassador.component.html',
  'features/referral/referral.component.ts',
  'features/become-ambassador/become-ambassador.component.ts',
];

function texteVisible(f: string): string[] {
  let src = readFileSync(join(__dirname, f), 'utf-8');
  if (f.endsWith('.ts')) src = src.slice(src.indexOf('template: `'), src.indexOf('`,', src.indexOf('template: `')));
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{[\s\S]*?\}\}/g, '⟨x⟩')
    .replace(/<[^>]*>/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^@|^\}/.test(l));
}

describe('typographie des pages de parrainage et de commission', () => {
  it.each(PAGES)('%s : espace insécable avant deux-points, point-virgule, ! ? et pourcentage', (f) => {
    const fautes = texteVisible(f).flatMap((l) => [
      ...(/ [:;!?](?=\s|$)/.test(l) ? [`espace normale avant la ponctuation : ${l}`] : []),
      ...(/[\d⟩]%/.test(l) ? [`% collé au nombre : ${l}`] : []),
    ]);
    expect(fautes).toEqual([]);
  });

  // Messages des toasts (chaînes du composant, hors gabarit) : même règle. `\u00a0` dans la source.
  const COMPOSANTS = [
    'features/ambassador/ambassador.component.ts',
    'features/referral/referral.component.ts',
    'features/become-ambassador/become-ambassador.component.ts',
  ];
  it.each(COMPOSANTS)('%s : messages des toasts', (f) => {
    const src = readFileSync(join(__dirname, f), 'utf-8');
    const messages = [...src.matchAll(/toast\.(?:success|error|info|warning)\(\s*'([^']*)'/g)].map((m) => m[1]);
    const fautes = messages.filter((m) => / [:;!?](?=\s|$)|\d%/.test(m));
    expect(fautes).toEqual([]);
  });
});
