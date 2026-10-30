// @vitest-environment node
/**
 * #745, F2 : l'API enregistre l'acceptation des CGU (date + version) à la création du compte. La
 * mention « tu acceptes les CGU et confirmes avoir 18 ans » doit donc précéder CHAQUE bouton qui
 * crée un compte : formulaire e-mail, « Continuer avec Google » de l'inscription ET de la connexion
 * (Google y crée le compte au premier passage). Lu dans les sources, comme auth-styles.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(__dirname, p), 'utf-8');
const note = read('auth-layout/signup-terms-note.component.html');

/** Position de chaque occurrence de `needle` dans `text`. */
const positions = (text: string, needle: string) =>
  [...text.matchAll(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].map((m) => m.index ?? 0);

describe('mention CGU + majorité avant toute création de compte', () => {
  it('la mention cite les CGU et les 18 ans', () => {
    expect(note).toContain('cguUrl');
    expect(note).toContain('18 ans ou plus');
  });

  it('inscription : sous le bouton Google, puis au-dessus de l’envoi du formulaire', () => {
    const html = read('register.component.html');
    const [google] = positions(html, '<mtc-google-auth-button');
    const notes = positions(html, '<mtc-signup-terms-note');
    expect(html).toContain('<mtc-signup-terms-note variant="google" />');
    expect(notes).toHaveLength(2);
    expect(notes[0]).toBeGreaterThan(google);
    expect(notes[0]).toBeLessThan(positions(html, '<form')[0]);
    // Avant le message d'erreur et après le bouton d'envoi : visible à côté de l'action.
    expect(notes[1]).toBeGreaterThan(positions(html, 'data-testid="register-submit"')[0]);
  });

  it('connexion : sous « Continuer avec Google », qui crée le compte au premier passage', () => {
    const html = read('login.component.html');
    expect(html).toContain('<mtc-signup-terms-note variant="google-login" />');
    expect(positions(html, '<mtc-signup-terms-note')[0]).toBeLessThan(positions(html, '<form')[0]);
  });

  it('finalisation Google : la majorité est rappelée avec les CGU', () => {
    expect(read('google-finalize.component.html')).toContain('18 ans ou plus');
  });
});
