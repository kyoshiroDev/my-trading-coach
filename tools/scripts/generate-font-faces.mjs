#!/usr/bin/env node
// Génère apps/app-mytradingcoach/src/styles/fonts.css depuis les feuilles @fontsource, en ne gardant
// que les sous-ensembles latin et latin-ext (budget du bundle : les blocs cyrillique, grec et
// vietnamien pesaient 13 ko dans le CSS initial sans jamais servir à une interface en français).
// Chaque bloc garde son `unicode-range` : le navigateur ne télécharge que ce que la page affiche.
// Usage : node tools/scripts/generate-font-faces.mjs (après une mise à jour de @fontsource).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const out = join(root, 'apps/app-mytradingcoach/src/styles/fonts.css');
// Graisses chargées par l'app (inchangées depuis la migration hors de Google Fonts).
export const FONTS = [
  ['space-grotesk', [500, 600, 700]],
  ['inter', [400, 500, 600, 700, 800]],
  ['jetbrains-mono', [400, 500, 600]],
];
const SUBSETS = ['latin-ext', 'latin'];

let css = `/* Fichier GÉNÉRÉ par tools/scripts/generate-font-faces.mjs : ne pas modifier à la main.
 * Sous-ensembles latin et latin-ext seulement (é, œ, €, ·, « », ’ sont dans latin). Vérifié par
 * src/styles/fonts.spec.ts. */\n`;
for (const [pkg, weights] of FONTS) {
  for (const w of weights) {
    const src = readFileSync(join(root, 'node_modules/@fontsource', pkg, `${w}.css`), 'utf8');
    for (const subset of SUBSETS) {
      const re = new RegExp(`/\\* ${pkg}-${subset}-${w}-normal \\*/\\s*(@font-face \\{[^}]*\\})`);
      const m = re.exec(src);
      if (!m) throw new Error(`${pkg} ${w} : bloc ${subset} introuvable`);
      const block = m[1].replace(/url\(\.\/files\//g, `url(../../../../node_modules/@fontsource/${pkg}/files/`);
      css += `\n/* ${pkg}-${subset}-${w}-normal */\n${block}\n`;
    }
  }
}
writeFileSync(out, css);
console.log(`fonts.css : ${FONTS.reduce((n, [, w]) => n + w.length, 0) * SUBSETS.length} blocs`);
