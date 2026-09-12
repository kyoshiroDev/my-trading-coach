// @vitest-environment node
/**
 * Animations des toasts — verrouillées sur les SOURCES.
 *
 * jsdom ne joue aucune animation CSS et les styles des composants n'y sont pas chargés :
 * Angular y retire le toast immédiatement (couvert par toasts.component.spec.ts). Sans ces
 * tests, retirer `animate.leave`, la barre ou une animation passerait inaperçu.
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
const rule = (sel: string) =>
  CSS.match(new RegExp(`(?:^|\\n)${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
const keyframes = (name: string) =>
  CSS.match(new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
const seconds = (decl: string, anim: string) =>
  parseFloat(decl.match(new RegExp(`animation:\\s*${anim}\\s+([\\d.]+)s`))?.[1] ?? '0');

describe('mtc-toasts — entrée (depuis le bord, pile qui se décale en douceur)', () => {
  it('le toast glisse depuis le bord droit sur toute sa largeur', () => {
    expect(keyframes('toast-in')).toMatch(/from\s*\{[^}]*translateX\(calc\(100% \+ 24px\)\)/);
    expect(seconds(rule('.toast'), 'toast-in')).toBeGreaterThanOrEqual(0.2);
  });

  it('la case s’ouvre en hauteur (grid-template-rows 0fr → 1fr) : pas de saut de la pile', () => {
    expect(keyframes('toast-slot-in')).toMatch(/from\s*\{\s*grid-template-rows:\s*0fr/);
    expect(rule('.toast-slot')).toContain('grid-template-rows: 1fr');
    expect(rule('.toast-clip')).toContain('min-height: 0');
  });
});

describe('mtc-toasts — sortie (vers le bord, puis repli)', () => {
  it('chaque case déclare animate.leave (sens selon le geste)', () => {
    expect(TEMPLATE).toMatch(/class="toast-slot"\s*\[animate\.leave\]="leaveClass\(t\.id\)"/);
  });

  it('le toast repart à droite (ou à gauche après un glisser), la case se replie ensuite', () => {
    expect(keyframes('toast-out')).toMatch(/translateX\(calc\(100% \+ 24px\)\)/);
    expect(keyframes('toast-out-left')).toMatch(/translateX\(calc\(-100% - 24px\)\)/);
    expect(keyframes('toast-slot-out')).toMatch(/100%\s*\{\s*grid-template-rows:\s*0fr/);
    const slotOut = seconds(rule('.toast-slot.toast-leave'), 'toast-slot-out');
    expect(slotOut).toBeGreaterThan(0);
    expect(slotOut).toBeLessThanOrEqual(0.5); // rapide : on ne fait pas attendre
    expect(rule('.toast-slot.toast-leave')).toContain('pointer-events: none');
  });

  it('toast-out n’a pas de `from` : la sortie part de la position du glisser, sans saut', () => {
    expect(keyframes('toast-out')).not.toMatch(/from\s*\{/);
  });
});

describe('mtc-toasts — barre de compte à rebours en haut', () => {
  it('ancrée en haut du toast, qui coupe ses débords (arrondi)', () => {
    const bar = rule('.toast-bar');
    expect(bar).toContain('position: absolute');
    expect(bar).toContain('top: 0');
    expect(bar).toContain('animation: toast-countdown linear forwards');
    expect(rule('.toast')).toContain('overflow: hidden');
  });

  it('se vide (scaleX 1 → 0) et se fige en pause', () => {
    expect(keyframes('toast-countdown')).toMatch(/from\s*\{\s*transform:\s*scaleX\(1\)[\s\S]*to\s*\{\s*transform:\s*scaleX\(0\)/);
    expect(rule('.toast-bar.paused')).toContain('animation-play-state: paused');
  });
});

describe('mtc-toasts — glisser et mouvement réduit', () => {
  it('glisser horizontal sans bloquer le défilement vertical', () => {
    expect(rule('.toast')).toContain('touch-action: pan-y');
  });

  it('mouvement réduit : pas de glissement ni de repli animé, barre par paliers', () => {
    const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.toast-slot,[\s\S]*?\.toast-slot\.toast-leave \.toast\s*\{\s*animation:\s*none/);
    expect(reduced).toMatch(/\.toast-bar\s*\{\s*animation-timing-function:\s*steps\(/);
  });
});
