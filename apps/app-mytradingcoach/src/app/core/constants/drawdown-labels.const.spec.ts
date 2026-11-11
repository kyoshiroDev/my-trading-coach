import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DRAWDOWN_LABELS } from './drawdown-labels.const';

/**
 * Test 6 du PROMPT-drawdown-max-par-compte : « Drawdown max » ne désigne JAMAIS la taille de la
 * règle. Règle = « Règle de drawdown », marge = « Marge avant le plancher » (contexte-com.md),
 * baisse mesurée = « Drawdown max ». Les gabarits sont lus sur disque, textes visibles compris.
 */
const app = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(app, path), 'utf8');
/** Texte visible d'un gabarit : sans les commentaires HTML. */
const visible = (path: string) => read(path).replace(/<!--[\s\S]*?-->/g, '');

/** Écrans qui montrent la TAILLE de la règle de drawdown d'un compte ou d'un plan. */
const RULE_SCREENS = [
  'features/accounts/accounts.component.html',
  'features/accounts/prop-firm-rules/prop-firm-rules.component.html',
  'features/onboarding/onboarding.component.html',
  'features/weekly-debrief/debrief.component.html',
];
/** Écrans qui montrent la MARGE restante avant le plancher. */
const MARGIN_SCREENS = [
  'features/accounts/accounts.component.html',
  'features/dashboard/components/session-live/components/live-prop-firm/live-prop-firm.component.html',
  'shared/components/perf-chart/perf-chart.component.html',
  'features/auth/auth-layout/auth-preview.component.html',
];

describe('vocabulaire du drawdown', () => {
  it('trois libellés distincts, infobulles courtes et sans tiret cadratin', () => {
    expect(DRAWDOWN_LABELS.max.label).toBe('Drawdown max');
    expect(DRAWDOWN_LABELS.margin.label).toBe('Marge avant le plancher');
    expect(DRAWDOWN_LABELS.rule.label).toBe('Règle de drawdown');
    for (const { help } of Object.values(DRAWDOWN_LABELS)) {
      expect(help.length).toBeLessThanOrEqual(160);
      expect(help).not.toContain('—');
      expect(help).not.toMatch(/rentable/i);
    }
    expect(DRAWDOWN_LABELS.max.help).toBe('Plus forte baisse depuis un sommet, trade par trade, sur la période. Tous comptes : le compte le plus touché.');
  });

  it.each(RULE_SCREENS)('%s : la règle s’appelle « Règle de drawdown », jamais « Drawdown max »', (path) => {
    const html = visible(path);
    expect(html).not.toMatch(/Drawdown max/);
    expect(html).toContain('ddLabels.rule.label');
    expect(html).toContain('[text]="ddLabels.rule.help"');
  });

  it.each(MARGIN_SCREENS)('%s : la marge s’appelle « Marge avant le plancher »', (path) => {
    const html = visible(path);
    expect(html).not.toMatch(/Marge (trailing )?drawdown|Marge avant la limite/);
    expect(html).toMatch(/Marge avant le plancher|ddLabels\.margin\.label/);
  });

  it('Mes comptes : libellé mobile de la colonne marge', () => {
    const ts = read('features/accounts/accounts.component.ts');
    expect(ts).not.toMatch(/'Marge (trailing )?drawdown'/);
    expect(ts).toContain('DRAWDOWN_LABELS.margin.label');
  });

  it('tableau de bord : « Drawdown max » reste le nom de la baisse mesurée', () => {
    const html = visible('features/dashboard/panels/dashboard-kpis/dashboard-kpis.component.html');
    expect(html).toContain('Drawdown max');
    expect(html).toContain(DRAWDOWN_LABELS.max.help);
  });
});
