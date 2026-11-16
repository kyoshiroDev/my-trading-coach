#!/usr/bin/env node
// Génère les images de partage (Open Graph, 1200×630) de la landing, une par page indexable et une
// par article de blog, plus le logo carré 512 px des données structurées (SEO phase 1, #1071).
// Chromium de Playwright (déjà installé pour les tests E2E), polices @fontsource du dépôt, couleurs
// lues dans global.css de la landing. Titres des articles lus dans leur frontmatter (`title`).
// Usage : node tools/scripts/generate-og-images.mjs   (à relancer après un nouvel article ou un
// titre modifié ; `landing-og-images.spec.ts` échoue si une image d'article manque).
// Cartes en JPEG (~40 Ko, contre ~330 Ko en PNG à cause du dégradé), logo en PNG (transparence).
// Fichiers non hashés (cache 1 an côté nginx) : si une image change, en changer le nom.
import { chromium } from '@playwright/test';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const landing = join(root, 'apps/landing-mytradingcoach');
const out = join(landing, 'public/og');
const css = await readFile(join(landing, 'src/styles/global.css'), 'utf8');
const token = (name) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`--${name} introuvable dans global.css`);
  return m[1];
};
const c = { bg: token('bg'), bg3: token('bg3'), blue: token('blue'), blue2: token('blue2'), txt: token('txt'), txt2: token('txt2'), txt3: token('txt3') };
const purple = '#8b5cf6'; // dégradé de marque (logo.svg)

const font = async (pkg, file) =>
  `data:font/woff2;base64,${(await readFile(join(root, 'node_modules/@fontsource', pkg, 'files', file))).toString('base64')}`;
const [disp, mono] = await Promise.all([
  font('space-grotesk', 'space-grotesk-latin-700-normal.woff2'),
  font('jetbrains-mono', 'jetbrains-mono-latin-500-normal.woff2'),
]);
const fontsLatinExt = await Promise.all([
  font('space-grotesk', 'space-grotesk-latin-ext-700-normal.woff2'),
  font('jetbrains-mono', 'jetbrains-mono-latin-ext-500-normal.woff2'),
]);

const logoMark = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${c.blue}"/><stop offset="100%" stop-color="${purple}"/></linearGradient></defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <polyline points="8,32 14,32 18,20 22,44 26,12 30,40 34,24 38,32 56,32" fill="none" stroke="${c.txt}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const card = ({ label, title }) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
  @font-face { font-family: D; src: url(${disp}) format('woff2'); font-weight: 700; unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
  @font-face { font-family: D; src: url(${fontsLatinExt[0]}) format('woff2'); font-weight: 700; unicode-range: U+0100-024F, U+0259, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20CF, U+2113, U+2C60-2C7F, U+A720-A7FF; }
  @font-face { font-family: M; src: url(${mono}) format('woff2'); font-weight: 500; unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+20AC; }
  @font-face { font-family: M; src: url(${fontsLatinExt[1]}) format('woff2'); font-weight: 500; unicode-range: U+0100-024F, U+1E00-1EFF; }
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body { background: radial-gradient(ellipse 60% 70% at 85% 20%, rgba(59,130,246,0.16), transparent 70%), linear-gradient(135deg, ${c.bg}, ${c.bg3});
    color: ${c.txt}; padding: 72px 80px; display: flex; flex-direction: column; justify-content: space-between; font-family: D, sans-serif; }
  .brand { display: flex; align-items: center; gap: 18px; font-size: 34px; font-weight: 700; letter-spacing: -0.5px; }
  .label { font-family: M, monospace; font-size: 24px; letter-spacing: 3px; text-transform: uppercase; color: ${c.blue2}; margin-bottom: 22px; }
  h1 { font-size: ${title.length > 70 ? 54 : title.length > 45 ? 62 : 72}px; line-height: 1.12; font-weight: 700; letter-spacing: -1px; max-width: 1040px;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .foot { display: flex; justify-content: space-between; align-items: center; font-family: M, monospace; font-size: 22px; color: ${c.txt3}; }
  .bar { width: 120px; height: 6px; border-radius: 3px; background: linear-gradient(90deg, ${c.blue}, ${purple}); }
</style></head><body>
  <div class="brand">${logoMark(56)}MyTradingCoach</div>
  <div><div class="label">${esc(label)}</div><h1>${esc(title)}</h1></div>
  <div class="foot"><span>www.mytradingcoach.app</span><span class="bar"></span></div>
</body></html>`;

// Pages (titre = H1 de la page, à garder en phase si le H1 change).
const pages = [
  { file: 'default.jpg', label: 'Journal de trading prop firm', title: 'Tiens tes règles quand c’est toi qui trades.' },
  { file: 'prop-firm.jpg', label: 'Traders futures en prop firm', title: 'Suis ta marge avant la limite de ta prop firm.' },
  { file: 'journal-trading-prop-firm.jpg', label: 'Trading prop firm', title: 'Le journal de trading prop firm et multi-comptes' },
  { file: 'blog.jpg', label: 'Blog', title: 'Journal de trading, prop firm, psychologie : les guides' },
  { file: 'ambassadeur.jpg', label: 'Programme ambassadeur', title: 'Recommande MyTradingCoach à ta communauté' },
];
const blogDir = join(landing, 'src/content/blog');
for (const f of (await readdir(blogDir)).filter((n) => n.endsWith('.md')).sort()) {
  const fm = (await readFile(join(blogDir, f), 'utf8')).split('---')[1] ?? '';
  const title = fm.match(/^title:\s*"(.*)"\s*$/m)?.[1];
  if (!title) throw new Error(`title introuvable dans ${f}`);
  pages.push({ file: `blog/${f.replace(/\.md$/, '.jpg')}`, label: 'Blog', title: title.replace(/\\"/g, '"') });
}

await mkdir(join(out, 'blog'), { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  for (const p of pages) {
    await page.setContent(card(p), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(out, p.file), type: 'jpeg', quality: 85 });
    console.log(`og/${p.file}`);
  }
  // Logo carré des données structurées (Organization.logo), même dessin que public/logo.svg.
  const logo = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await logo.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${logoMark(512)}</body></html>`);
  await logo.screenshot({ path: join(landing, 'public/icon/logo-512.png'), type: 'png', omitBackground: true });
  console.log('icon/logo-512.png');
} finally {
  await browser.close();
}
