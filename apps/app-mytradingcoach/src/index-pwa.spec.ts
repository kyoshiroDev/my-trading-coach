import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Manifest PWA et balises d'index.html : ni l'un ni l'autre ne peut lire une variable CSS, ce test
// garde leurs couleurs alignées sur theme.css et vérifie que chaque icône existe à la bonne taille.
const src = import.meta.dirname;
const publicDir = resolve(src, '..', 'public');
const html = readFileSync(resolve(src, 'index.html'), 'utf8');
const theme = readFileSync(resolve(src, 'styles/theme.css'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(publicDir, 'manifest.webmanifest'), 'utf8'));

const bg = /--bg:\s*(#[0-9a-fA-F]{6})/.exec(theme)?.[1];
const attr = (selector: RegExp) => selector.exec(html)?.[1];

interface Icon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

/** Largeur, hauteur et présence d'une couche alpha, lues dans l'en-tête IHDR du PNG. */
function png(path: string): { width: number; height: number; alpha: boolean } {
  const buf = readFileSync(resolve(publicDir, path));
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  const colorType = buf[25];
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), alpha: colorType === 4 || colorType === 6 };
}

describe('PWA : manifest et balises', () => {
  it('index.html déclare le manifest (le profil en dépend pour le push sur iPhone)', () => {
    expect(attr(/<link rel="manifest" href="([^"]+)"/)).toBe('manifest.webmanifest');
  });

  it('couleurs = --bg de theme.css (manifest et theme-color)', () => {
    expect(bg).toBeDefined();
    expect(manifest.background_color).toBe(bg);
    expect(manifest.theme_color).toBe(bg);
    expect(attr(/<meta name="theme-color" content="([^"]+)"/)).toBe(bg);
  });

  it('installable : nom, affichage standalone, start_url mesurée dans le scope', () => {
    expect(manifest.name).toBe('MyTradingCoach');
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.display).toBe('standalone');
    expect(manifest.scope).toBe('/');
    expect(manifest.start_url).toMatch(/^\/[^/].*[?&]source=pwa\b/);
    for (const s of manifest.shortcuts as { url: string }[]) expect(s.url).toMatch(/^\/[a-z-]+\?source=pwa$/);
  });

  it('icônes 192, 512 et maskable présentes à leur taille déclarée', () => {
    const icons = manifest.icons as Icon[];
    const sizes = icons.map((i) => `${i.sizes}:${i.purpose ?? 'any'}`);
    expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
    for (const icon of icons) {
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(png(icon.src), icon.src).toMatchObject({ width: w, height: h });
    }
    // Maskable : le système découpe la forme, aucun pixel transparent à montrer.
    expect(png(icons.find((i) => i.purpose === 'maskable')!.src).alpha).toBe(false);
  });

  it('iOS : apple-touch-icon PNG 180 opaque, mode application', () => {
    const href = attr(/<link rel="apple-touch-icon" href="([^"]+)"/)!;
    expect(href).toMatch(/\.png$/);
    // iOS remplit la transparence en noir : l'icône doit être pleine.
    expect(png(href)).toEqual({ width: 180, height: 180, alpha: false });
    expect(attr(/<meta name="apple-mobile-web-app-capable" content="([^"]+)"/)).toBe('yes');
    expect(attr(/<meta name="apple-mobile-web-app-title" content="([^"]+)"/)).toBe(manifest.short_name);
  });
});
