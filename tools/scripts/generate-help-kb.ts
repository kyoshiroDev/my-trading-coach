// Base de connaissances du support (#493) : génère `kb.generated.ts` depuis les fiches `kb/*.md`, pour que la
// base soit embarquée dans le build de l'API (webpack ne copie pas les .md). Usage : pnpm help-kb:generate
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseKbEntry } from '../../apps/api-mytradingcoach/src/modules/help/kb-parse';

const DIR = join(__dirname, '../../apps/api-mytradingcoach/src/modules/help');
const files = readdirSync(join(DIR, 'kb')).filter((f) => f.endsWith('.md')).sort();
const entries = files.map((f) => parseKbEntry(readFileSync(join(DIR, 'kb', f), 'utf8'), f));
const out = `// Généré par \`pnpm help-kb:generate\` depuis kb/*.md (#493). Ne pas modifier à la main.
import type { HelpKbEntry } from './kb-parse';

export const HELP_KB: readonly HelpKbEntry[] = ${JSON.stringify(entries, null, 2)};
`;
writeFileSync(join(DIR, 'kb.generated.ts'), out);
console.log(`${entries.length} fiches → kb.generated.ts`);
