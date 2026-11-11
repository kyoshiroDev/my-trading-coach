import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DRAWDOWN_LABELS } from './drawdown-labels';

/**
 * Vocabulaire du drawdown, source unique partagée par l'app et la landing (#937) :
 * « Drawdown max » = baisse mesurée, « Règle de drawdown » = taille de la règle,
 * « Marge avant le plancher » = marge restante. La landing n'a pas de suite de tests : ses textes
 * qui désignent la règle ou la marge sont vérifiés ici, lus sur disque.
 */
describe('DRAWDOWN_LABELS', () => {
  it('trois sens distincts, la règle ne s\'appelle jamais « Drawdown max »', () => {
    expect(DRAWDOWN_LABELS.max.label).toBe('Drawdown max');
    expect(DRAWDOWN_LABELS.rule.label).toBe('Règle de drawdown');
    expect(DRAWDOWN_LABELS.margin.label).toBe('Marge avant le plancher');
    for (const { label, help } of Object.values(DRAWDOWN_LABELS)) {
      expect(`${label} ${help}`).not.toMatch(/[–—]/);
    }
  });
});

describe('landing · vocabulaire de la règle et de la marge (#937)', () => {
  const landing = resolve(import.meta.dirname, '../../../apps/landing-mytradingcoach/src');
  const read = (path: string) => readFileSync(resolve(landing, path), 'utf8');

  it('la fiche des règles prend le libellé partagé, jamais « Drawdown max » en dur', () => {
    const view = read('data/prop-firm-rules-view.ts');
    expect(view).toContain('label: DRAWDOWN_LABELS.rule.label');
    expect(view).not.toMatch(/label: 'Drawdown max'/);
  });

  it('la marge se dit « avant le plancher », jamais « avant (le) drawdown » ni « avant le drawdown max »', () => {
    for (const path of [
      'components/MultiComptes.astro',
      'components/PropFirmLive.astro',
      'pages/journal-trading-prop-firm.astro',
      'content/blog/meilleur-journal-trading-prop-firm.md',
    ]) {
      expect(read(path), path).not.toMatch(/avant (le )?drawdown/i);
    }
  });
});
