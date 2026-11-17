// @vitest-environment node
/**
 * Contraste du texte posé sur un fond bleu plein (#1085). Le texte clair (--text, blanc) sur --blue ne fait
 * que 3:1 à 3,7:1, sous le minimum de 4,5:1 : un fond plein qui porte du texte utilise --primary (survol
 * --primary-hover), comme le prévoit theme.css. Lu dans les sources (jsdom ne calcule pas les styles).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const sansCommentaires = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const theme = sansCommentaires(readFileSync(join(__dirname, '../styles/theme.css'), 'utf-8'));
const tokens = Object.fromEntries([...theme.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

function fichiersCss(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiersCss(chemin);
    return nom.endsWith('.css') ? [chemin] : [];
  });
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contraste(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Fond bleu plein (pas un dégradé ni une teinte transparente) et texte clair déclaré dans la même règle.
const FOND_BLEU = /(?:^|;)\s*background(?:-color)?\s*:\s*(?:var\(--(?:blue|blue-bright)\)|#3b82f6|#60a5fa)\s*(?:!important\s*)?(?:;|$)/i;
const TEXTE_CLAIR = /(?:^|;)\s*color\s*:\s*(?:var\(--text(?:-2|-3)?\)|#fff(?:fff)?|white)\s*(?:!important\s*)?(?:;|$)/i;

describe('Contraste du texte sur les fonds bleus (#1085)', () => {
  it('blanc sur --primary et --primary-hover au-dessus de 4,5:1', () => {
    expect(tokens['--primary'], '--primary absent de theme.css').toMatch(/^#[0-9a-f]{6}$/i);
    expect(contraste('#ffffff', tokens['--primary'])).toBeGreaterThanOrEqual(4.5);
    expect(contraste('#ffffff', tokens['--primary-hover'])).toBeGreaterThanOrEqual(4.5);
  });

  it('aucune règle ne pose un texte clair sur --blue ou --blue-bright', () => {
    const fautifs: string[] = [];
    for (const fichier of fichiersCss(__dirname)) {
      const css = sansCommentaires(readFileSync(fichier, 'utf-8'));
      for (const [, selecteur, corps] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (FOND_BLEU.test(corps) && TEXTE_CLAIR.test(corps)) {
          fautifs.push(`${relative(__dirname, fichier)} : ${selecteur.trim()}`);
        }
      }
    }
    expect(fautifs, 'texte clair sur un fond bleu : utiliser var(--primary)').toEqual([]);
  });

  // Fond au repos sur --primary, fond au survol sur --primary-hover (le défaut d'origine était un survol
  // en --blue-bright, couleur du texte héritée de la règle de base).
  it.each([
    ['features/accounts/account-plan-wizard/account-plan-wizard.component.css', '.apw-card.primary', '.apw-card.primary:hover:not(:disabled)'],
    ['features/dashboard/components/session-live/components/live-prop-firm/live-prop-firm.component.css', '.pf-plan-cta-btn', '.pf-plan-cta-btn:hover'],
    ['shared/components/premium-lock/premium-lock.component.css', '.pl-btn', '.pl-btn:hover'],
    ['features/today-session/results-share/results-share.component.css', '.rs-primary', '.rs-primary:hover:not(:disabled)'],
    ['features/checkout/checkout-page.component.css', '.pay', '.pay:hover:not(:disabled)'],
  ])('%s : %s sur --primary, survol sur --primary-hover', (fichier, repos, survol) => {
    const css = sansCommentaires(readFileSync(join(__dirname, fichier), 'utf-8'));
    const regle = (selecteur: string) => {
      const echappe = selecteur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return css.match(new RegExp(`(?:^|\\})\\s*${echappe}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    };
    expect(regle(repos), `${repos} introuvable`).toMatch(/background\s*:\s*var\(--primary\)/);
    expect(regle(survol), `${survol} introuvable`).toMatch(/background\s*:\s*var\(--primary-hover\)/);
  });
});
