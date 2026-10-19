// @vitest-environment node
/**
 * Les modales de page (formulaire de Mes comptes, confirmation du Journal) doivent passer
 * AU-DESSUS du bouton menu mobile (150) et du « + » flottant (100) : à 100, le bouton menu
 * restait visible et cliquable par-dessus le voile.
 *
 * jsdom ne calcule aucun contexte d'empilement : l'invariant se verrouille à sa source, les
 * feuilles de style (même procédé que setup-modal-zindex.spec.ts, environnement `node`).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf-8');

/** z-index de la première règle `selector` qui en déclare un, commentaires retirés. */
const zIndexOf = (css: string, selector: string): number => {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let from = 0;
  for (;;) {
    const start = clean.indexOf(selector, from);
    if (start === -1) throw new Error(`z-index introuvable pour ${selector}`);
    const m = clean.slice(start, clean.indexOf('}', start)).match(/z-index:\s*(\d+)/);
    if (m) return Number(m[1]);
    from = start + selector.length;
  }
};

describe('Modales de page au-dessus du bouton menu mobile (invariant de z-index)', () => {
  const burger = zIndexOf(read('./shared/components/sidebar/sidebar.component.css'), '.burger {');

  it.each([
    ['Mes comptes', './features/accounts/accounts.component.css'],
    ['Journal', './features/journal/journal.component.css'],
  ])('%s : voile au palier 1000, au-dessus du bouton menu', (_name, file) => {
    const overlay = zIndexOf(read(file), '.modal-overlay {');
    expect(overlay).toBeGreaterThanOrEqual(1000);
    expect(overlay, `Voile à ${overlay}, bouton menu à ${burger}`).toBeGreaterThan(burger);
  });
});
