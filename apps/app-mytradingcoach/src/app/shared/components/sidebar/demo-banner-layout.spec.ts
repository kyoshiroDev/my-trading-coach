// @vitest-environment node
/**
 * Burger contenu dans le bandeau « Mode démo » sur téléphone (#611) — verrouillé sur les SOURCES.
 *
 * Le burger est `position: fixed` ; le bandeau est dans le flux. Rien ne les lie à part ces
 * valeurs : à 40 px de bandeau, le burger (14 px + 40 px) débordait de 14 px sur la page.
 * Même procédé que toasts-animation.spec.ts (`node:fs` en environnement node : un `.css?raw`
 * est vide sous vitest).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(__dirname, f), 'utf-8');
const TEMPLATE = read('sidebar.component.html');
const CSS = read('sidebar.component.css');
const px = (src: string, re: RegExp) => parseFloat(src.match(re)?.[1] ?? 'NaN');

// Bloc téléphone du mode démo (le fichier compte plusieurs @media (max-width: 768px)).
const DEMO = CSS.slice(CSS.indexOf('/* ─── Mode démo ─── */'));
const DEMO_PHONE = DEMO.slice(DEMO.indexOf('@media (max-width: 768px)'));
// Bloc téléphone du burger (taille de référence).
const BURGER_PHONE = CSS.slice(CSS.indexOf('/* ── Burger button'), CSS.indexOf('/* ─── Mode démo ─── */'));

describe('sidebar — burger dans le bandeau démo (téléphone)', () => {
  it('le burger porte la classe in-demo-banner en mode démo', () => {
    expect(TEMPLATE).toMatch(/class="burger"\s*\[class\.in-demo-banner\]="userStore\.isDemo\(\)"/);
  });

  it('le burger (décalage + hauteur) tient dans la hauteur du bandeau', () => {
    const bannerH = px(DEMO_PHONE, /\.main-content\.has-demo-banner\s*\{\s*--demo-banner-h:\s*(\d+)px/);
    const burgerH = px(BURGER_PHONE, /\.burger\s*\{[^}]*?\n\s*height:\s*(\d+)px/);
    const top = px(DEMO_PHONE, /\.burger\.in-demo-banner\s*\{\s*top:\s*calc\(env\(safe-area-inset-top\)\s*\+\s*(\d+)px\)/);
    expect(burgerH).toBe(40);
    expect(top + burgerH).toBeLessThanOrEqual(bannerH);
    expect(top).toBe(bannerH - burgerH - top); // centré verticalement
  });

  it('le texte du bandeau laisse la place du burger à droite', () => {
    const padRight = px(DEMO_PHONE, /\.demo-banner\s*\{[^}]*padding:\s*0\s+(\d+)px/);
    const burgerRight = px(BURGER_PHONE, /\n\s*right:\s*(\d+)px/);
    const burgerW = px(BURGER_PHONE, /\n\s*width:\s*(\d+)px/);
    expect(padRight).toBeGreaterThanOrEqual(burgerRight + burgerW);
  });
});
