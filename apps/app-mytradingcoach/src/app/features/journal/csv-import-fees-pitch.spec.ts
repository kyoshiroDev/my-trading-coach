// @vitest-environment node
/**
 * PROMPT-205 — le pitch « Sans le Cash history… » ne doit vivre que tant qu'aucun
 * fichier de frais n'est choisi.
 *
 * Il s'affichait sans condition dans la branche Tradovate : même après avoir sélectionné
 * un Cash History valide, le message restait sous le nom du fichier et laissait croire
 * que rien n'avait été pris en compte.
 *
 * Pourquoi une lecture de la source plutôt qu'un rendu : le template est piloté par des
 * entrées SIGNAL (`input()`), que ni `setInput` ni un composant hôte ne parviennent à
 * fournir une fois le composant recompilé en JIT par TestBed — d'où le `<div></div>`
 * qu'utilisent tous les specs de ce composant. Un miroir de template ne testerait que
 * lui-même. On vérifie donc la condition là où elle vit, ce qui échoue si quelqu'un la
 * retire, ou l'étend par erreur aux messages voisins.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Template dans le .html depuis l'étape 4 de l'audit : on lit le composant ET son template.
const source = () =>
  readFileSync(join(__dirname, 'csv-import.component.ts'), 'utf-8') + '\n' +
  readFileSync(join(__dirname, 'csv-import.component.html'), 'utf-8');

/**
 * Condition du bloc `@if (…) { … }` le plus proche qui englobe un marqueur donné.
 * Les accolades sont comptées pour ne pas confondre avec un bloc refermé avant.
 */
function conditionEnglobante(src: string, marqueur: string): string | null {
  const cible = src.indexOf(marqueur);
  if (cible === -1) throw new Error(`Marqueur introuvable : ${marqueur}`);

  // Les conditions contiennent elles-mêmes des parenthèses (`!feesFile()`) : on les
  // équilibre au lieu de s'arrêter à la première fermante.
  const ouvertures: { condition: string; finEntete: number }[] = [];
  for (const m of src.slice(0, cible).matchAll(/@if \(/g)) {
    let p = 1;
    let i = m.index! + m[0].length;
    for (; i < src.length && p > 0; i++) {
      if (src[i] === '(') p++;
      else if (src[i] === ')') p--;
    }
    const condition = src.slice(m.index! + m[0].length, i - 1).trim();
    const accolade = src.indexOf('{', i - 1);
    if (accolade !== -1) ouvertures.push({ condition, finEntete: accolade });
  }

  for (const { condition, finEntete } of ouvertures.reverse()) {
    let profondeur = 0;
    for (let i = finEntete; i < src.length; i++) {
      if (src[i] === '{') profondeur++;
      else if (src[i] === '}') {
        profondeur--;
        if (profondeur === 0) {
          if (i > cible) return condition; // le bloc se referme APRÈS le marqueur
          break; // bloc déjà refermé : ce n'est pas lui, on remonte encore
        }
      }
    }
  }
  return null;
}

describe('Import CSV — le pitch des frais est conditionné au fichier', () => {
  it('le pitch vit sous « !feesFile() »', () => {
    const condition = conditionEnglobante(source(), 'data-testid="fees-pitch"');

    expect(
      condition,
      'Le pitch n\'est plus conditionné : il reste affiché sous le nom du fichier choisi',
    ).toBe('!feesFile()');
  });

  it('le message « fichier vide » n\'est PAS pris dans cette condition', () => {
    // Il doit s'afficher justement QUAND un fichier est là. L'englober aurait remplacé
    // un message redondant par aucun message du tout.
    const condition = conditionEnglobante(source(), 'data-testid="fees-file-empty"');

    expect(condition).toBe('feesFileEmpty()');
  });

  it('le message « mauvais format » n\'est PAS pris dans cette condition', () => {
    const condition = conditionEnglobante(source(), 'data-testid="fees-file-invalid"');

    expect(condition).not.toBe('!feesFile()');
  });

  it('le pitch reste unique dans le template', () => {
    const n = (source().match(/data-testid="fees-pitch"/g) ?? []).length;
    expect(n).toBe(1);
  });
});
