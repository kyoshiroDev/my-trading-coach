import { describe, it, expect } from 'vitest';
import { renderEmailMarkdown } from './email-markdown';

describe('renderEmailMarkdown', () => {
  it('texte vide → chaîne vide', () => {
    expect(renderEmailMarkdown('   ')).toBe('');
  });

  it('échappe le HTML saisi (aucune balise ne passe telle quelle)', () => {
    const html = renderEmailMarkdown('<script>alert(1)</script> & <b>x</b>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('gras, italique, paragraphes et liste', () => {
    const html = renderEmailMarkdown('**Bravo** *toi*\n\n- un\n- deux');
    expect(html).toContain('<strong');
    expect(html).toContain('<em>toi</em>');
    expect(html.match(/<tr>/g)).toHaveLength(2);
  });

  it('titre sur une ligne', () => {
    expect(renderEmailMarkdown('# Nouveauté')).toContain('font-weight:700');
  });
});
