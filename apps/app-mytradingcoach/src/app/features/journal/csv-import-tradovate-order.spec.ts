// @vitest-environment node
/**
 * PROMPT-211 — hiérarchie du panneau Tradovate, verrouillée sur la SOURCE du template inline
 * (le composant se monte sans template en JIT, cf. les autres specs csv-import-*).
 *
 * Environnement `node` + `node:fs` : même procédé que toasts-animation.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Template dans le .html depuis l'étape 4 de l'audit : on lit le composant ET son template.
const SRC =
  readFileSync(join(__dirname, 'csv-import.component.ts'), 'utf-8') + '\n' +
  readFileSync(join(__dirname, 'csv-import.component.html'), 'utf-8');
const at = (needle: string) => {
  const i = SRC.indexOf(needle);
  expect(i, `introuvable : ${needle}`).toBeGreaterThan(-1);
  return i;
};

describe('Import — panneau Tradovate : connexion en premier, CSV en repli', () => {
  it('la reco de connexion précède le lien discret « ou importer un fichier CSV »', () => {
    expect(at('data-testid="import-tradovate-reco"')).toBeLessThan(at('data-testid="import-tradovate-csv-toggle"'));
  });

  it('les deux fichiers Tradovate ne sont montés QU’APRÈS le choix du repli CSV', () => {
    const branch = at('@if (!tvCsvOpen())');
    // Début de la branche repli : son lien de retour vers la connexion.
    const fallback = at('data-testid="import-tradovate-back"');
    expect(fallback).toBeGreaterThan(branch);
    expect(at('data-testid="import-tradovate-csv-toggle"')).toBeLessThan(fallback);
    expect(at('import-trades-input')).toBeGreaterThan(fallback);
    expect(at('import-fees-input')).toBeGreaterThan(fallback);
  });

  it('réutilise la modale de réassurance partagée (aucune logique OAuth dupliquée)', () => {
    expect(SRC).toContain('<mtc-tradovate-connect-modal');
    expect(SRC).not.toMatch(/authorizeUrl\(/);
  });

  it('mode connexion : pas de bouton « Importer » (rien à importer)', () => {
    const submit = at('data-testid="import-submit"');
    const guard = SRC.lastIndexOf('@if (!tvReco())', submit);
    expect(guard).toBeGreaterThan(-1);
    expect(SRC.slice(guard, submit)).not.toContain('}\n'); // la garde enveloppe bien le bouton
  });

  it('libellé factuel, sans caution de NinjaTrader (clause 17)', () => {
    expect(SRC).not.toMatch(/partenaire officiel|recommandé par ninjatrader|approuvé par/i);
  });
});
