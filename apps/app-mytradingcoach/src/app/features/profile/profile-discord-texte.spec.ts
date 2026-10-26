// @vitest-environment node
/**
 * Bloc Discord du Profil, texte du gabarit : consigne « coller le code après /verify » (le bouton
 * Copier ne copie plus la commande), bouton « Délier mon Discord », typographie française.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(__dirname, 'profile.component.html'), 'utf-8');
const bloc = html.slice(html.indexOf('<!-- ══ DISCORD'), html.indexOf('<!-- ══ MAINTENANCE'));
/** Texte visible : commentaires, interpolations, balises et lignes de contrôle (`@if`, `}`) retirés. */
const texte = bloc
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\{\{[\s\S]*?\}\}/g, '⟨x⟩')
  .replace(/<[^>]*>/g, '')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !/^@|^\}/.test(l))
  .join(' ');

describe('Profil, bloc Discord : texte', () => {
  it('consigne à côté du code', () => {
    expect(texte).toContain('Puis tape /verify dans Discord et colle ce code. Ne le partage pas.');
  });

  it('contre-épreuve : plus de commande « /verify code:… » à recopier', () => {
    expect(bloc).not.toContain('/verify code:');
  });

  it('bouton « Délier mon Discord », affiché seulement si le compte est relié', () => {
    expect(bloc).toContain("'Délier mon Discord'");
    const i = bloc.indexOf('data-testid="discord-unlink"');
    expect(bloc.lastIndexOf('@if (discordLinked())', i)).toBeGreaterThan(-1);
  });

  it('typographie : pas de tiret cadratin, espace insécable avant : ; ! ? %', () => {
    expect(bloc).not.toContain('—');
    // Les heures « HH:mm » sont dans une interpolation, déjà retirée.
    expect(texte.match(/ [:;!?%]/g)).toBeNull();
  });
});
