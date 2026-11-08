import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';
import { findForbiddenTerms } from './ai-text-guard';

/**
 * Balayage des textes d'IA et de coach (#881) : prompts, données figées de la démo, gabarits
 * d'e-mail et de notification, textes statiques de l'app. Échoue si une chaîne contient un terme
 * proscrit (mêmes motifs que le garde-fou de sortie, `ai-text-guard.ts`).
 *
 * Seules les chaînes sont lues (compilateur TypeScript), pas les commentaires. Exclus exprès :
 * `compliance.prompt.ts` (il cite les mots proscrits POUR le modèle) et le garde-fou lui-même.
 */

const ROOT = resolve(__dirname, '../../../../..');
const API = 'apps/api-mytradingcoach/src';
const APP = 'apps/app-mytradingcoach/src/app';

/** Fichiers et dossiers balayés. Un dossier est lu récursivement (hors specs). */
const TARGETS = [
  `${API}/modules/ai`,
  `${API}/modules/accounts/incidents`,
  `${API}/modules/admin/demo-data`,
  `${API}/modules/admin/demo-seed.ts`,
  `${API}/modules/daily-recap`,
  `${API}/modules/debrief`,
  `${API}/modules/resend/templates`,
  `${API}/modules/resend/campaigns`,
  `${API}/modules/push/trader-push-messages.ts`,
  `${API}/modules/push/trader-notifier.service.ts`,
  `${API}/modules/integrations/tradovate/tilt-detection.ts`,
  `${APP}/features/ai-insights`,
  `${APP}/features/weekly-debrief`,
  `${APP}/features/dashboard`,
  `${APP}/features/analytics/analytics.component.html`,
  `${APP}/features/onboarding/onboarding.model.ts`,
  `${APP}/features/scoring/scoring.component.html`,
];

const EXCLUDED = new Set([`${API}/modules/ai/prompts/compliance.prompt.ts`]);

/** Phrases autorisées nommément : hors du champ « texte de coach », avec la raison. */
const ALLOWED: { file: string; contains: string; reason: string }[] = [
  {
    file: `${API}/modules/resend/templates/index.ts`,
    contains: 'tu passeras automatiquement sur le plan gratuit',
    reason: "e-mail de facturation (rappel de renouvellement) : un fait d'abonnement, pas une prévision de résultat",
  },
];
const allowed = (file: string, s: string) => ALLOWED.some((a) => a.file === file && s.includes(a.contains));

function listFiles(target: string): string[] {
  const abs = join(ROOT, target);
  if (statSync(abs).isFile()) return [target];
  return readdirSync(abs, { recursive: true, encoding: 'utf8' })
    .map((f) => join(target, f))
    .filter((f) => /\.(ts|html)$/.test(f) && !/\.(spec|int-spec)\.ts$/.test(f) && statSync(join(ROOT, f)).isFile());
}

/** Chaînes d'un fichier TypeScript : littéraux et morceaux de gabarits, sans les commentaires. */
function tsStrings(source: string): string[] {
  const file = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) out.push(node.text);
    // Les chemins d'import ne sont pas des textes.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

/** Texte visible d'un gabarit Angular : sans commentaires, balises ni interpolations. */
function htmlText(source: string): string[] {
  return source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

const files = [...new Set(TARGETS.flatMap(listFiles))].filter((f) => !EXCLUDED.has(f)).sort();

describe('textes d’IA et de coach : aucun terme proscrit', () => {
  it('le balayage couvre bien les sources attendues', () => {
    expect(files.length).toBeGreaterThan(30);
    for (const must of [`${API}/modules/ai/ai.service.ts`, `${API}/modules/ai/agents/pattern.agent.ts`, `${API}/modules/ai/prompts/debrief.prompt.ts`, `${API}/modules/admin/demo-data/texts.ts`, `${APP}/features/dashboard/dashboard-charts.util.ts`]) {
      expect(files, must).toContain(must);
    }
  });

  it.each(files)('%s', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8');
    const strings = file.endsWith('.html') ? htmlText(source) : tsStrings(source);
    const offending = strings
      .filter((s) => !allowed(file, s))
      .map((s) => ({ s, ids: findForbiddenTerms(s) }))
      .filter((x) => x.ids.length)
      .map((x) => `[${x.ids.join(', ')}] ${x.s.slice(0, 160)}`);
    expect(offending, relative(ROOT, join(ROOT, file))).toEqual([]);
  });
});
