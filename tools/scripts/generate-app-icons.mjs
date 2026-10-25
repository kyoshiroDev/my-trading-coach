#!/usr/bin/env node
// Génère les icônes PNG de la PWA de l'app depuis le dessin de apps/app-mytradingcoach/public/logo.svg
// (Chromium de Playwright, déjà installé pour les tests E2E). Couleurs lues dans theme.css.
// Usage : node tools/scripts/generate-app-icons.mjs
// Les PNG ne sont pas hashés (cache 1 an côté nginx) : si le dessin change, changer aussi leur nom.
import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const app = join(import.meta.dirname, '..', '..', 'apps/app-mytradingcoach');
const out = join(app, 'public/pwa');
const theme = await readFile(join(app, 'src/styles/theme.css'), 'utf8');
const token = (name) => {
  const m = theme.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`--${name} introuvable dans theme.css`);
  return m[1];
};
const [blue, purple, text] = [token('blue'), token('purple'), token('text')];

// Même tracé que logo.svg (viewBox 64). `rx` : coins arrondis (icône « any », le système l'affiche
// telle quelle) ; 0 = carré plein jusqu'aux bords (maskable et iOS, qui découpent eux-mêmes).
// `scale` : réduit la courbe vers le centre pour qu'elle tienne dans la zone sûre.
const icon = ({ rx, scale }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${blue}"/>
      <stop offset="100%" stop-color="${purple}"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="${rx}" fill="url(#g)"/>
  <g transform="translate(32 32) scale(${scale}) translate(-32 -32)">
    <polyline points="8,32 14,32 18,20 22,44 26,12 30,40 34,24 38,32 56,32" fill="none"
      stroke="${text}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

const targets = [
  { file: 'icon-192.png', size: 192, rx: 14, scale: 1 },
  { file: 'icon-512.png', size: 512, rx: 14, scale: 1 },
  // maskable : la courbe tient dans le cercle sûr (rayon 40 %) avec de la marge
  { file: 'icon-maskable-512.png', size: 512, rx: 0, scale: 0.8 },
  // iOS arrondit lui-même les coins : carré plein, sans transparence
  { file: 'apple-touch-icon-180.png', size: 180, rx: 0, scale: 0.9 },
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, rx, scale } of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0;width:${size}px;height:${size}px;background:transparent">${icon({ rx, scale })}</body>`,
  );
  // Fond transparent : seuls les coins de l'icône « any » le sont réellement.
  await page.screenshot({ path: join(out, file), omitBackground: true });
  console.log(`${file} (${size}×${size})`);
}
await browser.close();
