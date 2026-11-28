/**
 * Base de connaissances du support (#493) : lecture des fiches Markdown de `kb/`. Fonction PURE, partagée par
 * le script de génération (`kb.generated.ts`, embarqué dans le build) et la spec qui vérifie que le fichier
 * généré colle aux fiches. Front-matter minimal : `id`, `title`, `keywords: [a, b]`, `audience: all | app`,
 * `links: [/chemin]`.
 */
export type HelpAudience = 'all' | 'app';

export interface HelpKbEntry {
  id: string;
  title: string;
  keywords: string[];
  audience: HelpAudience;
  links: string[];
  /** Réponse en Markdown, avec ses variables `{{NOM}}` non remplacées. */
  body: string;
}

const list = (v: string): string[] =>
  v.trim().replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);

export function parseKbEntry(source: string, file = 'fiche'): HelpKbEntry {
  const m = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file} : front-matter absent`);
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const audience = meta['audience'];
  if (!meta['id'] || !meta['title'] || (audience !== 'all' && audience !== 'app')) {
    throw new Error(`${file} : id, title et audience (all | app) obligatoires`);
  }
  return {
    id: meta['id'],
    title: meta['title'],
    keywords: list(meta['keywords'] ?? ''),
    audience,
    links: list(meta['links'] ?? ''),
    body: m[2].trim(),
  };
}
