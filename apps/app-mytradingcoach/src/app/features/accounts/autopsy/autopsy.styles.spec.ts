import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// `?raw` rend une chaîne vide pour un .css sous vitest : lecture directe du fichier.
const css = (path: string) => readFileSync(join(__dirname, path), 'utf-8');
const AUTOPSY_CSS = css('account-autopsy.component.css');
const ACCOUNTS_CSS = css('../accounts.component.css');
const SHEETS_CSS = css('../lost-account/lost-account-sheets.component.css');
const TOASTS_CSS = css('../../../shared/components/toasts/toasts.component.css');

/**
 * Couleurs de l'autopsie et de ses entrées (revue #712) : action principale en bleu (`--primary`,
 * theme.css), cyan réservé à l'IA et au temps réel (design.md), aucune couleur en dur.
 */
const rule = (sheet: string, selector: string) => {
  const i = sheet.indexOf(`${selector} {`);
  expect(i, `règle ${selector}`).toBeGreaterThanOrEqual(0);
  return sheet.slice(i, sheet.indexOf('}', i));
};

describe("Autopsie : couleurs (revue #712)", () => {
  it('page : aucun cyan, aucune valeur de couleur en dur', () => {
    expect(AUTOPSY_CSS.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/--cyan|#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it('action principale en bleu sur la page, dans Mes comptes, la feuille et le toast', () => {
    for (const [sheet, sel] of [
      [AUTOPSY_CSS, '.btn.pri'], [ACCOUNTS_CSS, '.lost-btn.pri'], [SHEETS_CSS, '.la-btn.pri'], [TOASTS_CSS, '.toast-action'],
    ] as const) {
      expect(rule(sheet, sel)).toMatch(/background: var\(--primary\)/);
      expect(rule(sheet, sel)).not.toMatch(/--cyan/);
    }
  });

  it('courbe et pastilles des constats hors cyan', () => {
    expect(rule(AUTOPSY_CSS, '.chart .line')).toMatch(/stroke: var\(--text-2\)/);
    expect(rule(AUTOPSY_CSS, '.find i')).not.toMatch(/--cyan/);
  });
});
