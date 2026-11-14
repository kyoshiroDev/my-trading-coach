/**
 * Audit fonctionnel #994 (lot 1c) — règles CSS du journal sur téléphone et écran tactile.
 * F19 : `.td-price:first-of-type` / `:last-of-type` ne visaient rien (toutes les cellules sont des
 *       <span>, la première est l'heure) : heure, entrée et sortie se plaçaient au hasard.
 * F20 : boutons « Supprimer la journée » / « Déplacer » à opacity 0 hors survol : invisibles mais
 *       cliquables au doigt.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = readFileSync(join(__dirname, 'journal.component.css'), 'utf8');
const HTML = readFileSync(join(__dirname, 'journal.component.html'), 'utf8');
/** Bloc `@media …` (accolades équilibrées) qui contient `mustContain` : le fichier en a plusieurs. */
const block = (media: string, mustContain: string) => {
  let from = 0;
  for (;;) {
    const start = CSS.indexOf(media, from);
    if (start < 0) return '';
    let depth = 0;
    for (let i = CSS.indexOf('{', start); i < CSS.length; i++) {
      if (CSS[i] === '{') depth++;
      else if (CSS[i] === '}' && --depth === 0) {
        const body = CSS.slice(start, i + 1);
        if (body.includes(mustContain)) return body;
        from = i + 1;
        break;
      }
    }
  }
};

describe('Journal — téléphone', () => {
  it('entrée et sortie ont leur propre classe, placées explicitement ; plus de :first-of-type', () => {
    expect(HTML).toContain('class="td-price td-entry mono"');
    expect(HTML).toContain('class="td-price td-exit mono"');
    const mobile = block('@media (max-width: 768px)', '.trade-row');
    expect(mobile).not.toMatch(/td-price:(first|last)-of-type/);
    expect(mobile).toMatch(/\.td-entry\s*\{[^}]*grid-column: 3/);
    expect(mobile).toMatch(/\.td-time\s*\{[^}]*grid-column: 1/);
  });
});
