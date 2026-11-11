// @vitest-environment node
/**
 * Aucun « $ » en dur à côté d'un montant de trading dans les gabarits de l'app (#947) : un compte
 * EUR afficherait « 3 000 $ ». Les montants passent par `money` / `pnlFormat` (devise du compte) et
 * les champs de saisie par `currencyAffix`. Exception : l'aperçu statique de l'écran de connexion.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, 'features');
const EXCLUS = ['auth/auth-preview.component.html'];
// « ' $' » concaténé, « ${{ x }} », « {{ x }}$ » / « {{ x }} $ », « >$< » (préfixe de champ).
const DOLLAR = /' \$'|\$\{\{|\}\}\s?\$|>\s*\$\s*</;

function templates(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return templates(p);
    return p.endsWith('.html') ? [p] : [];
  });
}

describe('gabarits : pas de « $ » en dur sur un montant', () => {
  it('aucune occurrence', () => {
    const hits: string[] = [];
    for (const f of templates(ROOT)) {
      const rel = relative(ROOT, f);
      if (EXCLUS.some((e) => rel.endsWith(e))) continue;
      readFileSync(f, 'utf-8').split('\n').forEach((line, i) => {
        if (DOLLAR.test(line)) hits.push(`${rel}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
