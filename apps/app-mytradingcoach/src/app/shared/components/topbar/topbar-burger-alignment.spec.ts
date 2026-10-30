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
import { existsSync, readFileSync } from 'node:fs';
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

/**
 * Pages du shell (donc avec le burger) SANS la topbar commune : chacune a son propre en-tête.
 * Une nouvelle page sans topbar fait échouer l'inventaire, pour qu'on l'aligne avant de l'ajouter.
 * Valeur = conteneur de la page dans son CSS (null : en-tête propre testé à part, Ma session).
 */
const SANS_TOPBAR: Record<string, string | null> = {
  'features/today-session/today-session.component': null,
  // Classe commune .mtc-page / .mtc-page-head / .mtc-page-title (styles.css).
  'features/sessions/sessions.component': '.sessions-page',
  'features/eco-calendar/eco-calendar.component': '.eco-page',
  'features/ambassador/ambassador.component': '.content',
  'features/referral/referral.component': '.content',
  'features/become-ambassador/become-ambassador.component': '.content',
};

describe('pages du shell sans topbar commune', () => {
  const routes = read('../../../app.routes.ts');
  const shell = routes.slice(routes.indexOf('sidebar.component'), routes.indexOf("path: '**'"));
  const pages = [...shell.matchAll(/import\('\.\/([^']+)'\)/g)].map((m) => m[1]);
  const usesTopbar = (page: string) =>
    ['.ts', '.html']
      .map((ext) => join(__dirname, '../../..', page + ext))
      .filter(existsSync)
      .some((f) => readFileSync(f, 'utf-8').includes('<mtc-topbar'));

  const source = (page: string, ext: string) => {
    const f = join(__dirname, '../../..', page + ext);
    return existsSync(f) ? readFileSync(f, 'utf-8') : '';
  };
  const communes = Object.entries(SANS_TOPBAR).filter((e): e is [string, string] => e[1] !== null);

  it('inventaire à jour : toute page sans topbar a été mesurée', () => {
    expect(pages.length, 'routes du shell introuvables').toBeGreaterThan(10);
    expect(pages.filter((p) => !usesTopbar(p)).sort()).toEqual(Object.keys(SANS_TOPBAR).sort());
  });

  it('Ma session (mobile) : ligne du titre = boîte du burger, centrée avec lui', () => {
    const css = read('../../../features/today-session/today-session.component.css');
    const mobile = css.slice(css.indexOf('@media (max-width: 768px)'));
    const padTop = px(decl(mobile, '.session-page', 'padding-top'));
    const lh = px(decl(mobile, '.mtc-sess-h1', 'line-height'));
    const burgerH = px(decl(sidebarCss, '.burger', 'height'));
    const burgerTop = px(decl(sidebarCss, '.burger', 'top'));
    expect(lh).toBe(burgerH);
    expect(Math.abs(padTop + lh / 2 - (burgerTop + burgerH / 2))).toBeLessThanOrEqual(0.5);
  });

  // Géométrie de la classe commune, lue dans styles.css (règles mobiles après .mtc-page).
  const globalCss = read('../../../../styles.css');
  const pageCss = globalCss.slice(globalCss.indexOf('.mtc-page {'));
  const mobile = pageCss.slice(pageCss.indexOf('@media (max-width: 768px)'));

  it('classe commune (mobile) : ligne du titre = boîte du burger, place réservée à droite', () => {
    const burgerH = px(decl(sidebarCss, '.burger', 'height'));
    const burgerTop = px(decl(sidebarCss, '.burger', 'top'));
    expect(decl(mobile, '.mtc-page', 'padding').split(' ')[0], 'haut du conteneur').toBe('0');
    const headTop = px(decl(mobile, '.mtc-page-head', 'padding-top'));
    const lh = px(decl(mobile, '.mtc-page-title', 'line-height'));
    expect(lh).toBe(burgerH);
    expect(Math.abs(headTop + lh / 2 - (burgerTop + burgerH / 2))).toBeLessThanOrEqual(0.5);
    // Rien sous le burger : bord droit de l'en-tête à gauche du burger, avec un écart.
    const reserve = px(tokens['--page-pad-mobile']) + px(decl(mobile, '.mtc-page-head', 'padding-right'));
    const burgerSpan = px(decl(sidebarCss, '.burger', 'right')) + px(decl(sidebarCss, '.burger', 'width'));
    expect(reserve - burgerSpan).toBeGreaterThanOrEqual(MARGE_MIN);
  });

  it('classe commune : pleine largeur, grille de cartes à colonnes automatiques', () => {
    expect(pageCss.slice(0, pageCss.indexOf('@media'))).not.toMatch(/max-width/);
    expect(decl(pageCss, '.mtc-cards', 'grid-template-columns')).toMatch(/^repeat\(auto-fit,/);
  });

  it.each(communes)('%s : en-tête commun, titre en premier, aucun plafond ni padding local', (page, root) => {
    const tpl = source(page, '.html') || source(page, '.ts');
    const css = source(page, '.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(tpl).toMatch(new RegExp(`class="${root.slice(1)} mtc-page"`));
    // Le titre est le premier élément de l'en-tête : c'est lui qui tient la ligne du burger.
    expect(tpl).toMatch(/class="[^"]*\bmtc-page-head"[^>]*>\s*(?:<!--[\s\S]*?-->\s*)*(?:<div[^>]*>\s*)?<h1 class="[^"]*\bmtc-page-title\b/);
    // Une règle de composant a une spécificité plus forte que styles.css : elle écraserait la classe.
    const esc = root.replace('.', '\\.');
    const rules = [...css.matchAll(new RegExp(`(?:^|[}\\s,])${esc}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join(';');
    expect(rules, `${root} ne doit plus porter de padding`).not.toMatch(/(?:^|[;\s])padding(?:-top)?\s*:/);
    expect(rules, `${root} ne doit plus porter de plafond`).not.toMatch(/max-width\s*:/);
  });
});

/**
 * Compte démo (#721) : le bandeau « Mode démo » est collant en haut de la zone de contenu,
 * au-dessus de tout (z-index 50). Collée elle aussi à top 0, la topbar passait dessous en
 * défilant et son titre devenait illisible (vu à 390 px). Elle se cale sous le bandeau, et le
 * sélecteur de compte sous elle ; hors démo, --demo-banner-h vaut 0 et rien ne bouge.
 */
describe('compte démo : topbar sous le bandeau collant', () => {
  const sansVar = (v: string) => v.replace(/var\(--demo-banner-h,\s*0px\)/g, '0px');

  it('le bandeau est collant à top 0 et passe au-dessus de la topbar', () => {
    expect(decl(sidebarCss, '.demo-banner', 'position')).toBe('sticky');
    expect(px(decl(sidebarCss, '.demo-banner', 'top'))).toBe(0);
    expect(Number(decl(sidebarCss, '.demo-banner', 'z-index'))).toBeGreaterThan(
      Number(decl(topbarCss, '.topbar', 'z-index')),
    );
  });

  it('la topbar colle sous le bandeau, le sélecteur de compte sous la topbar', () => {
    expect(decl(topbarCss, '.topbar', 'top')).toContain('var(--demo-banner-h');
    expect(decl(topbarCss, '.topbar-accounts', 'top')).toContain('var(--demo-banner-h');
  });

  it('hors démo (bandeau à 0 px), positions inchangées', () => {
    expect(px(sansVar(decl(topbarCss, '.topbar', 'top')))).toBe(0);
    expect(px(sansVar(decl(topbarCss, '.topbar-accounts', 'top')))).toBe(px(tokens['--topbar-h']));
  });
});
