import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseKbEntry } from './kb-parse';
import { HELP_KB } from './kb.generated';
import { HELP_KB_DYNAMIC_VARIABLES, HELP_KB_STATIC_VARIABLES, kbVariables, renderKbBody } from './kb-render';

/* Base de connaissances du support (#493, étape 1) : règles de contenu verrouillées. */

const DIR = join(__dirname, 'kb');
const files = readdirSync(DIR).filter((f) => f.endsWith('.md')).sort();
const fromFiles = files.map((f) => parseKbEntry(readFileSync(join(DIR, f), 'utf8'), f));
/** Texte affiché, liens Markdown retirés (une URL peut contenir des chiffres). */
const visible = (body: string) => body.replace(/\]\([^)]*\)/g, ']');

describe('base de connaissances du support (#493)', () => {
  it('une trentaine de fiches, ids uniques et égaux au nom du fichier', () => {
    expect(fromFiles.length).toBeGreaterThanOrEqual(30);
    expect(new Set(fromFiles.map((e) => e.id)).size).toBe(fromFiles.length);
    files.forEach((f, i) => expect(f).toBe(`${fromFiles[i].id}.md`));
  });

  it('le module embarqué dans le build est à jour (pnpm help-kb:generate)', () => {
    expect(HELP_KB).toEqual(fromFiles);
  });

  it('aucun montant ni durée chiffrée écrit en dur : seulement des variables', () => {
    for (const e of fromFiles) {
      const text = visible(e.body);
      expect(text, `${e.id} : chiffre en dur`).not.toMatch(/\d/);
      expect(e.title, `${e.id} : chiffre dans le titre`).not.toMatch(/\d/);
      expect(text, `${e.id} : symbole monétaire sans variable`).not.toMatch(/(?<!\}\} )[€$]/);
    }
  });

  it('toute variable a une valeur (statique ou fournie à l’exécution)', () => {
    const known = new Set([...Object.keys(HELP_KB_STATIC_VARIABLES), ...HELP_KB_DYNAMIC_VARIABLES]);
    for (const e of fromFiles) for (const v of kbVariables(e.body)) expect(known.has(v), `${e.id} : {{${v}}}`).toBe(true);
    const vars = { ...HELP_KB_STATIC_VARIABLES, FOUNDER_SEATS_LABEL: 'x', PROP_FIRM_LIST: 'x' };
    for (const e of fromFiles) expect(renderKbBody(e.body, vars)).not.toContain('{{');
    expect(() => renderKbBody('{{INCONNUE}}', vars)).toThrow(/INCONNUE/);
  });

  it('conformité : support@, jamais hello@ ni « partenaire officiel », tutoiement, réponses courtes', () => {
    for (const e of fromFiles) {
      expect(e.body).not.toMatch(/hello@/i);
      expect(e.body).not.toMatch(/partenaire officiel/i);
      expect(e.body).not.toMatch(/\bvous\b/i);
      const lines = e.body.split('\n').filter((l) => l.trim()).length;
      expect(lines, `${e.id} : ${lines} lignes`).toBeLessThanOrEqual(6);
    }
  });

  it('front-matter : audience, mots-clés et liens présents', () => {
    for (const e of fromFiles) {
      expect(['all', 'app']).toContain(e.audience);
      expect(e.keywords.length, e.id).toBeGreaterThanOrEqual(5);
      for (const l of e.links) expect(l, e.id).toMatch(/^(\/|https:\/\/)/);
    }
  });
});
