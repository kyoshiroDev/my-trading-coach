import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// `?raw` rend une chaîne vide pour un .css sous vitest : lecture directe du fichier.
const file = (path: string) => readFileSync(join(__dirname, path), 'utf-8');
const GLOBAL_CSS = file('../../../../styles.css');
const THEME_CSS = file('../../../../styles/theme.css');
const FORM_CSS = file('auth-form.css');
const CARD_CSS = file('card-page.css');
const CARD_SIGNUP_CSS = file('card-page-signup.css');
const PITCH_CSS = file('auth-pitch.component.css');
const LOGIN_HTML = file('../login.component.html');
const REGISTER_HTML = file('../register.component.html');

const rule = (sheet: string, selector: string) => {
  const i = sheet.indexOf(`${selector} {`);
  expect(i, `règle ${selector}`).toBeGreaterThanOrEqual(0);
  return sheet.slice(i, sheet.indexOf('}', i));
};

/** Contraste WCAG entre deux couleurs #rrggbb. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const token = (name: string) => THEME_CSS.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))![1];

describe('autoremplissage du navigateur (C1)', () => {
  const autofill = rule(GLOBAL_CSS, 'select:-webkit-autofill');

  it('fond repeint et texte clair imposés, même quand le champ a son propre anneau (focus, erreur)', () => {
    // Sans `!important`, `input:focus { box-shadow }` d'un composant effaçait l'ombre : fond clair
    // de Chrome sous un texte clair, illisible.
    expect(autofill).toMatch(/-webkit-text-fill-color: var\(--text\) !important/);
    expect(autofill).toMatch(/box-shadow:\s*0 0 0 1000px var\(--autofill-bg, var\(--bg-2\)\) inset,\s*var\(--field-ring, 0 0 0 0 transparent\) !important/);
    expect(autofill).toMatch(/transition: background-color 9999s ease-out 0s !important/);
  });

  it('formulaire d’inscription et de connexion : fond du champ et anneaux passés par des variables', () => {
    expect(rule(FORM_CSS, '\ninput')).toMatch(/--autofill-bg: var\(--bg\)/);
    expect(rule(FORM_CSS, 'input:focus')).toMatch(/--field-ring: 0 0 0 3px var\(--blue-glow\);\s*box-shadow: var\(--field-ring\)/);
    expect(rule(FORM_CSS, '.form-group.input-error input')).toMatch(/--field-ring: 0 0 0 3px var\(--red-dim\);\s*box-shadow: var\(--field-ring\)/);
  });

  it('pages carte (mot de passe oublié, réinitialisation, Google) : même anneau, sans couleur en dur', () => {
    for (const sheet of [CARD_CSS, CARD_SIGNUP_CSS]) {
      const focus = rule(sheet, 'input:focus');
      expect(focus).toMatch(/box-shadow: var\(--field-ring\)/);
      expect(focus).not.toMatch(/rgba?\(|#[0-9a-f]{3,6}/i);
      expect(rule(sheet, '.form-group.input-error input')).not.toMatch(/rgba?\(|#[0-9a-f]{3,6}/i);
    }
  });

  it('texte lisible sur le fond repeint : contraste AA (≥ 4,5:1)', () => {
    expect(contrast(token('text'), token('bg'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('text'), token('bg-2'))).toBeGreaterThanOrEqual(4.5);
  });

  it('attributs autocomplete : identifiant + mot de passe actuel à la connexion, nouveau à l’inscription', () => {
    expect(LOGIN_HTML).toMatch(/type="email"[\s\S]*?autocomplete="username"/);
    expect(LOGIN_HTML).toMatch(/autocomplete="current-password"/);
    expect(REGISTER_HTML).toMatch(/autocomplete="email"/);
    expect(REGISTER_HTML.match(/autocomplete="new-password"/g)).toHaveLength(2);
  });
});

describe('colonne de présentation, à partir de 1024 px (C2)', () => {
  it('logo, contenu et pastilles centrés dans une colonne de 560 px au plus, texte aligné à gauche', () => {
    const col = rule(PITCH_CSS, '.pitch-foot');
    expect(PITCH_CSS).toMatch(/\.brand,\s*\.pitch-body,\s*\.pitch-foot \{/);
    expect(col).toMatch(/align-self: center/);
    expect(col).toMatch(/max-width: 560px/);
    expect(rule(PITCH_CSS, '.brand')).toMatch(/object-position: left center/);
    expect(PITCH_CSS).not.toMatch(/text-align: center/);
  });

  it('pastilles au-dessus du badge « interne » (8 px du bas + 22 px) : 44 px de marge basse', () => {
    expect(rule(PITCH_CSS, ':host')).toMatch(/padding: 28px 36px 44px/);
    expect(PITCH_CSS).toMatch(/@media \(min-width: 1280px\) \{\s*:host \{\s*padding: 40px 64px 44px/);
  });
});
