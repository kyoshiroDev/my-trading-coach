// @vitest-environment node
/**
 * Couleurs des pastilles de streak (Score) : variables --streak-0 … --streak-4 de theme.css, posées
 * par une classe niveau-N. Avant (#754) : 5 couleurs hexadécimales en dur dans le composant, appliquées
 * en style lié ([style.background]). Niveau calculé sur l'activité réelle par streak.ts. Lu dans les
 * sources (jsdom ne calcule pas les styles).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const lire = (f: string) => readFileSync(join(__dirname, f), 'utf-8');
const ts = lire('scoring.component.ts');
const streak = lire('streak.ts');
const html = lire('scoring.component.html');
const css = lire('scoring.component.css').replace(/\/\*[\s\S]*?\*\//g, '');
const theme = lire('../../../styles/theme.css').replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = Object.fromEntries([...theme.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const resoudre = (v: string): string => v.replace(/var\((--[\w-]+)\)/, (_, n: string) => resoudre(tokens[n] ?? ''));

// Couleurs d'avant : la variable ne doit pas changer le rendu.
const AVANT = ['#1a2535', '#1a3a2a', '#1e5c3a', '#1a7a4a', '#10b981'];
const NIVEAUX = [0, 1, 2, 3, 4];

describe('Score : couleurs des pastilles de streak', () => {
  it('aucune couleur en dur dans le calcul des pastilles (niveau 0 à 4 seulement)', () => {
    expect(streak, 'streak.ts : niveauActivite introuvable').toContain('export function niveauActivite');
    expect(streak).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(ts).toContain('calculerStreak(');
    expect(ts, 'pastilles tirées au hasard').not.toContain('Math.random');
  });

  it('pastille sans style lié, niveau porté par une classe', () => {
    const dot = html.match(/<div\s+class="streak-dot[^"]*"[\s\S]*?><\/div>/)?.[0] ?? '';
    expect(dot, 'pastille introuvable').not.toBe('');
    expect(dot).not.toMatch(/\[style|\sstyle="/);
    expect(dot).toContain('niveau-{{ p.niveau }}');
  });

  it.each(NIVEAUX)('niveau %i : règle CSS sur sa variable, même couleur qu’avant', (n) => {
    expect(css).toMatch(new RegExp(`\\.streak-dot\\.niveau-${n}\\s*\\{\\s*background:\\s*var\\(--streak-${n}\\);`));
    expect(resoudre(tokens[`--streak-${n}`] ?? '').toLowerCase()).toBe(AVANT[n]);
  });
});
