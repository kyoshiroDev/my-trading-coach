// @vitest-environment node
/**
 * Animation de sortie des toasts — verrouillée sur les SOURCES.
 *
 * jsdom ne joue aucune animation CSS et les styles des composants n'y sont pas chargés :
 * Angular y retire le toast immédiatement (couvert par toasts.component.spec.ts). Sans ces
 * tests, retirer `animate.leave` ou vider `.toast-leave` ferait disparaître le toast d'un coup
 * en production sans qu'aucun test ne le voie.
 *
 * Environnement `node` + `node:fs` : même procédé que setup-modal-zindex.spec.ts (un `.css?raw`
 * est vide sous vitest, et `node:fs` n'est pas résolu dans un spec jsdom sous `nx test`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(__dirname, f), 'utf-8');
const TEMPLATE = read('toasts.component.html');
const CSS = read('toasts.component.css');
const rule = (sel: string) => CSS.match(new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

describe('mtc-toasts — animation de sortie', () => {
  it('chaque toast déclare animate.leave avec la classe de sortie', () => {
    expect(TEMPLATE).toMatch(/class="toast \{\{ t\.type \}\}"[\s\S]*?animate\.leave="toast-leave"/);
  });

  it('.toast-leave joue une animation courte, de durée non nulle, et ne capte plus les clics', () => {
    const leave = rule('.toast-leave');
    const duration = parseFloat(leave.match(/animation:\s*toast-out\s+([\d.]+)s/)?.[1] ?? '0');
    expect(duration).toBeGreaterThan(0);
    expect(duration).toBeLessThanOrEqual(0.3); // rapide : on ne fait pas attendre
    expect(leave).toContain('pointer-events: none');
    expect(CSS).toMatch(/@keyframes toast-out[\s\S]*?opacity: 0/);
  });

  it('prefers-reduced-motion : entrée ET sortie désactivées (retrait immédiat)', () => {
    const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.toast,\s*\.toast-leave\s*\{\s*animation:\s*none/);
  });
});
