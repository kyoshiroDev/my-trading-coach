import { Logger } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

/**
 * Polices de la marque intégrées au visuel Instagram (data URI) : l'image Docker de l'API n'a que des
 * polices système, et le rendu ne fait aucune requête externe. Fichiers lus une fois dans
 * `node_modules/@fontsource`, cherché depuis le dossier courant puis ses parents (prod : /app).
 * Pas de `require.resolve` ni de `createRequire` : webpack les remplace dans le bundle de l'API.
 * Lecture impossible → police système (avertissement journalisé).
 */
const FONTS: { family: string; weight: number; file: string }[] = [
  { family: 'Inter', weight: 400, file: '@fontsource/inter/files/inter-latin-400-normal.woff2' },
  { family: 'Space Grotesk', weight: 700, file: '@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2' },
  { family: 'JetBrains Mono', weight: 400, file: '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2' },
];

let cache: string | null = null;
const logger = new Logger('GiveawayInstagramFonts');

/** Premier `node_modules` (dossier courant puis parents) qui contient le fichier. */
export function findFontFile(file: string, from = process.cwd()): string | null {
  for (let dir = from, i = 0; i < 6; i++) {
    const candidate = join(dir, 'node_modules', file);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function instagramFontFaces(): string {
  if (cache !== null) return cache;
  try {
    cache = FONTS.map((f) => {
      const path = findFontFile(f.file);
      if (!path) throw new Error(`absent : ${f.file}`);
      const b64 = readFileSync(path).toString('base64');
      return `@font-face{font-family:'${f.family}';font-weight:${f.weight};font-style:normal;src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
    }).join('\n');
  } catch (err) {
    logger.warn(`Polices du visuel Instagram introuvables (${(err as Error).message}), police système.`);
    cache = '';
  }
  return cache;
}
