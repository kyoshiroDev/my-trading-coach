// Analyses IA des annonces publiées, relues pour un jour passé — fonctions PURES (aucun service
// Nest) : le seed démo les importe aussi sous tsx (cf. mémoire « seed démo sous tsx »).
import type { EcoResultAnalysis } from './eco-calendar.types';

/** Nom d'annonce sans suffixe de période : « Nonfarm Payrolls (Oct) » → « Nonfarm Payrolls ». */
export const stripPeriod = (name: string): string => name.replace(/\s*\([^)]*\)\s*$/, '').trim();

/** Signature normalisée des actifs (même règle que la clé Redis de `analyzeReleasedEvent`). */
export const assetsSignature = (assets: readonly string[]): string =>
  [...assets].map((a) => a.trim().toUpperCase()).sort().join(',') || 'none';

export interface StoredReleaseAnalysis {
  eventName: string;
  assetsKey: string;
  analysisJson: string;
  createdAt: Date;
}

/**
 * Une analyse par annonce pour l'utilisateur : celle de SA signature d'actifs si elle existe,
 * sinon la plus récente d'une autre signature, réduite aux actifs qu'il trade (l'interprétation
 * reste ; aucun sentiment sur un actif qu'il ne trade pas). Aucune analyse → annonce absente.
 */
export function pickReleaseAnalyses(
  rows: readonly StoredReleaseAnalysis[],
  userAssets: readonly string[],
): Record<string, EcoResultAnalysis> {
  const sig = assetsSignature(userAssets);
  const mine = new Set(userAssets.map((a) => a.trim().toUpperCase()));
  const byEvent = new Map<string, StoredReleaseAnalysis[]>();
  for (const r of rows) byEvent.set(r.eventName, [...(byEvent.get(r.eventName) ?? []), r]);
  const out: Record<string, EcoResultAnalysis> = {};
  for (const [eventName, list] of byEvent) {
    const exact = list.find((r) => r.assetsKey === sig);
    const row = exact ?? [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    let analysis: EcoResultAnalysis;
    try {
      analysis = JSON.parse(row.analysisJson) as EcoResultAnalysis;
    } catch {
      continue;
    }
    if (!exact) {
      analysis = {
        ...analysis,
        assetSentiments: (analysis.assetSentiments ?? []).filter((s) => mine.has(s.asset.trim().toUpperCase())),
      };
    }
    out[eventName] = analysis;
  }
  return out;
}

/**
 * Ajoute chaque analyse sous le libellé affiché de son annonce (`nameFr`, sans suffixe de période) :
 * le front cherche l'analyse avec le nom qu'il affiche, l'API la range sous le nom FMP.
 */
export function withDisplayNames(
  analyses: Record<string, EcoResultAnalysis>,
  events: readonly { name: string; nameFr: string | null }[],
): Record<string, EcoResultAnalysis> {
  const out = { ...analyses };
  for (const e of events) {
    const a = analyses[stripPeriod(e.name)];
    if (a && e.nameFr) out[stripPeriod(e.nameFr)] = a;
  }
  return out;
}
