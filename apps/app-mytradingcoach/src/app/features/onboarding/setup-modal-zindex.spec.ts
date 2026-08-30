// @vitest-environment node
/**
 * PROMPT-199 tâche 1 — la modale de setup doit passer AU-DESSUS du wizard.
 *
 * Le bouton « + Ajouter un setup » de l'étape Setups semblait ne rien faire : la modale
 * partagée s'ouvrait à z-index 200, sous l'overlay de l'onboarding à 300. Elle était
 * bien dans le DOM — c'est précisément pour ça qu'un test « présent dans le DOM »
 * n'aurait rien vu.
 *
 * jsdom ne calcule aucun contexte d'empilement : aucun test de rendu ne peut constater
 * le recouvrement. On verrouille donc l'invariant à sa source. Fichier séparé et en
 * environnement `node` : la lecture disque est impossible sous jsdom, et les mélanger
 * cassait `nx test` sans afficher le moindre résultat.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PROMPT-199 tâche 1 — la modale de setup doit passer AU-DESSUS du wizard.
 *
 * Le bouton « + Ajouter un setup » de l'étape Setups semblait ne rien faire : la modale
 * partagée s'ouvrait à z-index 200, sous l'overlay de l'onboarding à 300. Elle était
 * bien dans le DOM — c'est précisément pour ça qu'un test « présent dans le DOM »
 * n'aurait rien vu, et que le bug est passé.
 *
 * jsdom ne calcule aucun contexte d'empilement : aucun test de rendu ne peut constater
 * le recouvrement. On verrouille donc l'invariant à sa source, les deux feuilles de
 * style, ce qui échoue si l'un des deux nombres repasse du mauvais côté.
 */
describe('Modale de setup au-dessus du wizard (invariant de z-index)', () => {
  const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf-8');
  /**
   * Les commentaires sont retirés AVANT la recherche : ceux qui documentent ces règles
   * citent d'autres valeurs de z-index, qu'un parseur naïf capturerait à la place de la
   * déclaration réelle.
   */
  const zIndexOf = (css: string, selector: string): number => {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const start = clean.indexOf(selector);
    if (start === -1) throw new Error(`Règle ${selector} introuvable`);
    const block = clean.slice(start, clean.indexOf('}', start));
    const m = block.match(/z-index:\s*(\d+)/);
    if (!m) throw new Error(`z-index introuvable pour ${selector}`);
    return Number(m[1]);
  };

  it('la modale de setup est au-dessus de l\'overlay d\'onboarding', () => {
    const wizard = zIndexOf(read('./onboarding.component.css'), '.overlay {');
    const modal = zIndexOf(
      read('../../shared/components/setup-form-modal/setup-form-modal.component.css'),
      '.stp-ov {',
    );

    expect(
      modal,
      `Modale à ${modal}, wizard à ${wizard} : « + Ajouter un setup » rouvrirait une modale invisible`,
    ).toBeGreaterThan(wizard);
  });

  it('la modale reste sous les toasts globaux', () => {
    const modal = zIndexOf(
      read('../../shared/components/setup-form-modal/setup-form-modal.component.css'),
      '.stp-ov {',
    );
    // styles.css : 10000. Une modale au-dessus masquerait les messages d'erreur.
    expect(modal).toBeLessThan(10000);
  });

});
