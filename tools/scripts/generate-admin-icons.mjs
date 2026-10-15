#!/usr/bin/env node
// Génère les icônes PNG de la PWA admin depuis apps/admin-mytradingcoach/public/icons/icon.svg
// (Chromium de Playwright, déjà installé pour les tests E2E).
// Usage : node tools/scripts/generate-admin-icons.mjs
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', '..', 'apps/admin-mytradingcoach/public/icons');
const svg = await readFile(join(dir, 'icon.svg'), 'utf8');
const BG = '#070809'; // --bg de l'admin
const targets = [
  { file: 'icon-192.png', size: 192, padding: 0 },
  { file: 'icon-512.png', size: 512, padding: 0 },
  // maskable : le motif tient dans la zone sûre (80 %), fond plein jusqu'aux bords
  { file: 'icon-maskable-512.png', size: 512, padding: 0.12 },
  // iOS arrondit lui-même les coins : carré plein, sans transparence
  { file: 'apple-touch-icon.png', size: 180, padding: 0.06 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, padding } of targets) {
  const inner = Math.round(size * (1 - 2 * padding));
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0;background:${BG};display:grid;place-items:center;width:${size}px;height:${size}px">
       <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div>
     </body>`,
  );
  await page.screenshot({ path: join(dir, file), omitBackground: false });
  console.log(`${file} (${size}×${size})`);
}
await browser.close();
