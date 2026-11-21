import { Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';

/**
 * Polices de la marque intégrées au visuel Instagram (data URI) : l'image Docker de l'API n'a que des
 * polices système, et le rendu ne fait aucune requête externe. Fichiers lus une fois depuis
 * `node_modules/@fontsource` (résolus à l'exécution, hors bundle) ; lecture impossible → police système.
 */
const FONTS: { family: string; weight: number; file: string }[] = [
  { family: 'Inter', weight: 400, file: '@fontsource/inter/files/inter-latin-400-normal.woff2' },
  { family: 'Inter', weight: 700, file: '@fontsource/inter/files/inter-latin-700-normal.woff2' },
  { family: 'Inter', weight: 800, file: '@fontsource/inter/files/inter-latin-800-normal.woff2' },
  { family: 'JetBrains Mono', weight: 400, file: '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2' },
];

let cache: string | null = null;
const logger = new Logger('GiveawayInstagramFonts');

export function instagramFontFaces(): string {
  if (cache !== null) return cache;
  try {
    const req = createRequire(join(process.cwd(), 'package.json'));
    cache = FONTS.map((f) => {
      const b64 = readFileSync(req.resolve(f.file)).toString('base64');
      return `@font-face{font-family:'${f.family}';font-weight:${f.weight};font-style:normal;src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
    }).join('\n');
  } catch (err) {
    logger.warn(`Polices du visuel Instagram introuvables (${(err as Error).name}), police système.`);
    cache = '';
  }
  return cache;
}
