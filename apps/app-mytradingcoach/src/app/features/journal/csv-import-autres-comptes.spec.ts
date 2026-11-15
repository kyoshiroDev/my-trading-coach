// @vitest-environment node
/**
 * #1001 : le même trade sur deux comptes (copy trading) est importé dans chacun. Le résultat de
 * l'import dit combien de trades existaient déjà dans un autre compte, pour repérer un fichier
 * importé dans le mauvais compte.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { alsoInOtherAccountLine } from './csv-import.component';

describe('Import CSV : trades déjà présents dans un autre compte (#1001)', () => {
  it('pluriel', () => {
    expect(alsoInOtherAccountLine({ name: 'Apex 50k #1', count: 12 })).toBe(
      '12 trades existent aussi dans le compte « Apex 50k #1 » : importés ici aussi.',
    );
  });

  it('singulier', () => {
    expect(alsoInOtherAccountLine({ name: 'Apex 50k #1', count: 1 })).toBe(
      '1 trade existe aussi dans le compte « Apex 50k #1 » : importé ici aussi.',
    );
  });

  it('une ligne par compte dans le résultat', () => {
    const html = readFileSync(join(__dirname, 'csv-import.component.html'), 'utf-8');
    expect(html).toContain('@for (o of result()!.alsoInOtherAccounts ?? []; track o.accountId)');
    expect(html).toContain('alsoInOtherAccountLine(o)');
  });
});
