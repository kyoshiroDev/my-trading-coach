/**
 * Mini-Markdown des emails de campagne → HTML inline (styles en dur : les clients mail ignorent
 * les feuilles de style). Utilisé par l'API (envoi) et l'admin (aperçu) : même rendu des deux côtés.
 *
 * Supporté : paragraphes (ligne vide), « # titre », **gras**, *italique*, listes « - » ou « • ». Le texte est ÉCHAPPÉ
 * avant toute mise en forme : aucun HTML saisi par l'admin n'arrive tel quel dans l'email.
 */
export function renderEmailMarkdown(raw: string): string {
  if (!raw?.trim()) return '';

  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const inline = (s: string) =>
    escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#eef3fb;">$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');

  const blocks = raw.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);

  return blocks
    .map((block) => {
      const lines = block.split('\n');

      if (/^#\s+/.test(block) && lines.length === 1) {
        return `<p style="font-size:16px;font-weight:700;color:#eef3fb;margin:22px 0 8px;">${inline(block.replace(/^#\s+/, ''))}</p>`;
      }

      if (lines.every((l) => /^[-•]\s+/.test(l))) {
        const items = lines
          .map((l) => `<tr><td style="vertical-align:top;padding:2px 8px 2px 0;color:#60a5fa;">•</td><td style="padding:2px 0;color:#9bb0cf;line-height:1.6;">${inline(l.replace(/^[-•]\s+/, ''))}</td></tr>`)
          .join('');
        return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">${items}</table>`;
      }

      const withBreaks = lines.map(inline).join('<br/>');
      return `<p style="color:#9bb0cf;line-height:1.7;margin:0 0 14px;">${withBreaks}</p>`;
    })
    .join('');
}
