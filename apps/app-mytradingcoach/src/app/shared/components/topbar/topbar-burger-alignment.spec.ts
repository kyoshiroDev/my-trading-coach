// @vitest-environment node
/**
 * Géométrie du burger mobile dans l'en-tête des pages, lue dans les feuilles source.
 *
 * Le burger appartient à la sidebar et se pose en position FIXE par-dessus la topbar : rien
 * ne le relie à elle dans le DOM. Il était codé en dur (40 px, top 14 px) : 9 px de plus que
 * le bouton Discord voisin, centre 6 px trop bas et bord bas à 2 px de la ligne de l'en-tête.
 *
 * jsdom ne calcule aucun layout (getBoundingClientRect y vaut 0) : on évalue donc les
 * déclarations réelles (calc + variables de theme.css, safe-area à 0 comme avec la barre
 * d'état « black » de index.html). Mesure réelle en navigateur : voir la PR.
 * Fichier en environnement `node` pour lire le disque (cf. plan-modal-layout.spec.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (...p: string[]) =>
  readFileSync(join(__dirname, ...p), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');

const theme = read('../../../../styles/theme.css');
const topbarCss = read('topbar.component.css');
const sidebarCss = read('../sidebar/sidebar.component.css');

const tokens = Object.fromEntries(
  [...theme.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
);

/** Évalue une longueur CSS en px : calc(), var() de theme.css, env() à 0. */
function px(value: string): number {
  let v = value;
  for (let i = 0; i < 10 && v.includes('var('); i++) {
    v = v.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
      expect(tokens[name], `variable ${name} absente de theme.css`).toBeDefined();
      return `(${tokens[name]})`;
    });
  }
  const expr = v.replace(/env\([^)]*\)/g, '0px').replace(/calc/g, '').replace(/px/g, '');
  expect(expr, `longueur non évaluable : ${value}`).toMatch(/^[\d\s.+\-*/()]+$/);
  return Function(`return (${expr});`)() as number;
}

/** Dernière valeur (celle qui gagne) de `prop` dans les blocs dont le sélecteur est exactement `selector`. */
function decl(css: string, selector: string, prop: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const values = [...css.matchAll(new RegExp(`(?:^|[{}\\s,])${esc}\\s*\\{([^}]*)\\}`, 'g'))]
    .flatMap((b) => [...b[1].matchAll(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+);`, 'g'))])
    .map((m) => m[1].trim());
  expect(values.length, `${prop} absent de ${selector}`).toBeGreaterThan(0);
  return values[values.length - 1];
}

const MARGE_MIN = 6; // écart visible minimal entre le bas du burger et la ligne de l'en-tête
const TAP_MIN = 44; // Apple HIG / WCAG 2.5.5

describe('burger mobile ↔ en-tête des pages', () => {
  const headerH = px(decl(topbarCss, '.topbar', 'height'));
  const border = px(tokens['--topbar-border-w']);
  const usable = headerH - border; // hauteur utile : la ligne de séparation est en bas
  const burgerH = px(decl(sidebarCss, '.burger', 'height'));
  const burgerTop = px(decl(sidebarCss, '.burger', 'top'));

  it('la topbar et le burger lisent les mêmes variables (rien en dur)', () => {
    expect(decl(topbarCss, '.topbar', 'height')).toBe('var(--topbar-h)');
    expect(decl(sidebarCss, '.burger', 'height')).toContain('var(--topbar-btn-h)');
    expect(decl(sidebarCss, '.burger', 'top')).toContain('var(--topbar-h)');
  });

  it('le burger a la hauteur du bouton Discord voisin', () => {
    expect(burgerH).toBe(px(decl(topbarCss, '.tb-discord', 'height')));
  });

  it('il est centré verticalement dans l’en-tête, comme ses boutons et le titre', () => {
    expect(Math.abs(burgerTop + burgerH / 2 - usable / 2)).toBeLessThanOrEqual(0.5);
  });

  it('il ne déborde pas et garde une marge visible avec la ligne de séparation', () => {
    expect(burgerTop).toBeGreaterThanOrEqual(0);
    expect(usable - (burgerTop + burgerH)).toBeGreaterThanOrEqual(MARGE_MIN);
  });

  it('sa zone tactile fait au moins 44 px et reste dans l’en-tête', () => {
    const tap = px(decl(sidebarCss, '.burger::before', 'height'));
    expect(tap).toBeGreaterThanOrEqual(TAP_MIN);
    expect(px(decl(sidebarCss, '.burger::before', 'width'))).toBeGreaterThanOrEqual(TAP_MIN);
    const center = burgerTop + burgerH / 2;
    expect(center - tap / 2).toBeGreaterThanOrEqual(0);
    expect(center + tap / 2).toBeLessThanOrEqual(usable);
  });

  it('compte démo : centré dans le bandeau, sans en déborder', () => {
    const bannerH = px(tokens['--demo-banner-h-mobile']);
    const top = px(decl(sidebarCss, '.burger.in-demo-banner', 'top'));
    expect(Math.abs(top + burgerH / 2 - (bannerH - border) / 2)).toBeLessThanOrEqual(0.5);
    expect(bannerH - border - (top + burgerH)).toBeGreaterThanOrEqual(MARGE_MIN);
  });
});
