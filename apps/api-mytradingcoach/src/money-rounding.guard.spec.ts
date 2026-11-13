// @vitest-environment node
/**
 * Une seule règle d'arrondi au centime dans tout le dépôt : `roundCents` (@mtc/shared), identique à
 * `round(x::text::numeric, 2)` des agrégats SQL (décision SCA-B2 du 2026-10-03). `toFixed(2)` et
 * `Math.round(x * 100) / 100` arrondissent la valeur BINAIRE (1 231,495 → 1 231,49) : un total ou un
 * montant calculé ainsi peut différer d'un centime du même chiffre calculé en base (audit des chiffres, lot 3).
 *
 * Garde-fou : aucun arrondi numérique au centime « à la main » dans le code de l'API, des fronts et
 * des libs. Le formatage d'un texte (`${x.toFixed(2)} EUR`) n'est pas visé, seul un résultat NUMÉRIQUE.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO = join(__dirname, '../../..');
const DIRS = [
  'apps/api-mytradingcoach/src',
  'apps/app-mytradingcoach/src',
  'apps/admin-mytradingcoach/src',
  'libs',
];

// `+(… ).toFixed(2)`, `+x.toFixed(2)`, `+xs.reduce(…).toFixed(2)`, `Number(… .toFixed(2))`, `parseFloat(… .toFixed(2))`, `Math.round(… * 100) / 100`.
const PATTERNS = [
  /\+\(\s*[^;]{0,300}?\)\s*\.toFixed\(2\)/g,
  /\+[A-Za-z_][^;]{0,300}?\.toFixed\(2\)/g,
  /(?:Number|parseFloat)\([^;]{0,300}?\.toFixed\(2\)\)/g,
  // Indépendant de l'imbrication des parenthèses : la fin « * 100) / 100 » précédée d'un Math.round( dans l'instruction.
  /Math\.round\([^;]{0,300}?\*\s*100\s*\)\s*\/\s*100\b/g,
];

/**
 * Exceptions assumées, chacune avec sa raison. Le `pnl` STOCKÉ d'un trade entre dans la clé de
 * dédoublonnage (`dedupeKey` : asset|side|date|entrée|sortie|pnl) : changer son arrondi changerait la
 * clé de trades déjà en base et recréerait des doublons à la resynchro. Bloqué tant que la réparation
 * #950 n'est pas passée en prod (point B1 de l'audit).
 */
const EXCEPTIONS: { file: string; match: string; reason: string }[] = [
  { file: 'apps/api-mytradingcoach/src/modules/trades/trade-metrics.util.ts', match: 'dto.pnl.toFixed(2)', reason: 'pnl stocké, clé de dédoublonnage (B1)' },
  { file: 'apps/api-mytradingcoach/src/modules/trades/trade-metrics.util.ts', match: '+pnl.toFixed(2)', reason: 'pnl stocké, clé de dédoublonnage (B1)' },
  { file: 'apps/api-mytradingcoach/src/modules/integrations/tradovate/tradovate-trade.mapper.ts', match: 'pair.sellPrice - pair.buyPrice', reason: 'pnl stocké, clé de dédoublonnage (B1)' },
  { file: 'libs/shared/src/trade-risk.ts', match: 'ticks * tickValue', reason: 'pnl stocké, clé de dédoublonnage (B1)' },
  { file: 'apps/app-mytradingcoach/src/app/features/journal/trade-form.component.ts', match: 'instr.tickValue * qty', reason: 'pnl saisi, même arrondi que l’API (B1)' },
  { file: 'apps/app-mytradingcoach/src/app/features/journal/trade-form.component.ts', match: 'variation * capital * lev', reason: 'pnl saisi, même arrondi que l’API (B1)' },
  { file: 'apps/api-mytradingcoach/src/test/analytics-legacy.service.ts', match: 'grossProfit / grossLoss', reason: 'étalon figé de l’équivalence SQL (copie historique, ne se modifie pas)' },
  { file: 'libs/shared/src/trade-stats.ts', match: 'Math.round(abs * 100) / 100', reason: 'roundCents lui-même (notation exponentielle)' },
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === 'node_modules' || n === 'dist') return [];
    if (statSync(p).isDirectory()) return sources(p);
    return /\.ts$/.test(n) && !/\.(int-)?spec\.ts$/.test(n) ? [p] : [];
  });
}

describe('arrondi au centime : roundCents partout', () => {
  it('les motifs repèrent les formes connues, et pas le formatage d’un texte', () => {
    const hit = (code: string) => PATTERNS.some((re) => new RegExp(re.source).test(code));
    for (const code of [
      'total: Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100,',
      'tradingPnl: n === 0 ? 0 : Math.round((realizedPnl + (payouts?.total ?? 0)) * 100) / 100,',
      'const lev = Math.round((t.pnl / (v * capital)) * 100) / 100;',
      'const a = Math.round(x * 100) / 100;',
      'const b = +(a + b).toFixed(2);',
      'const c = Number(x.toFixed(2));',
      'const d = parseFloat((t10 - t2).toFixed(2));',
      'const e = +xs.reduce((s, l) => s + l.amount, 0).toFixed(2);',
      'const f = +x.toFixed(2);',
    ]) expect(hit(code), code).toBe(true);
    for (const code of [
      'text(`${x.toFixed(2)} EUR`, 440, 11);',
      "return `${value.toFixed(2)} ${code}`;",
      'const pct = Math.round(x * 100);',
    ]) expect(hit(code), code).toBe(false);
  });

  it('aucun toFixed(2) ni Math.round(x * 100) / 100 numérique hors exceptions documentées', () => {
    const hits: string[] = [];
    for (const dir of DIRS) {
      for (const f of sources(join(REPO, dir))) {
        const rel = relative(REPO, f);
        const text = readFileSync(f, 'utf-8');
        for (const re of PATTERNS) {
          for (const m of text.matchAll(re)) {
            const allowed = EXCEPTIONS.some((e) => e.file === rel && m[0].includes(e.match));
            if (!allowed) hits.push(`${rel}:${text.slice(0, m.index).split('\n').length} ${m[0].replace(/\s+/g, ' ').slice(0, 80)}`);
          }
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('chaque exception existe encore (pas d’exception morte)', () => {
    const dead = EXCEPTIONS.filter((e) => !readFileSync(join(REPO, e.file), 'utf-8').includes(e.match));
    expect(dead).toEqual([]);
  });
});
