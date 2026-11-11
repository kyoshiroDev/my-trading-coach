// Analyses IA des annonces publiées, relues pour un jour passé — fonctions PURES (aucun service
// Nest) : le seed démo les importe aussi sous tsx (cf. mémoire « seed démo sous tsx »).
import type { EcoResultAnalysis } from './eco-calendar.types';

const GAPS = new Set(['above', 'inline', 'below', 'no_consensus']);

/** Nom d'annonce sans suffixe de période : « Nonfarm Payrolls (Oct) » → « Nonfarm Payrolls ». */
export const stripPeriod = (name: string): string => name.replace(/\s*\([^)]*\)\s*$/, '').trim();

/** Actifs normalisés : trim, majuscules, sans vide, dédoublonnés, triés. */
export const normalizeAssets = (assets: readonly string[]): string[] =>
  [...new Set(assets.map((a) => a.trim().toUpperCase()).filter(Boolean))].sort();

/**
 * Signature des actifs : clé Redis de l'analyse, `assetsKey` d'EcoReleaseAnalysis et signatures de
 * la génération automatique (#920). Dédoublonnée : « MNQ, mnq » = « MNQ ».
 */
export const assetsSignature = (assets: readonly string[]): string => normalizeAssets(assets).join(',') || 'none';

export interface StoredReleaseAnalysis {
  eventName: string;
  assetsKey: string;
  analysisJson: string;
  createdAt: Date;
}

/**
 * Une analyse par annonce pour l'utilisateur : celle de SA signature d'actifs si elle existe,
 * sinon la plus récente d'une autre signature (l'interprétation et l'écart ne dépendent pas des
 * actifs). Aucune analyse → annonce absente.
 */
export function pickReleaseAnalyses(
  rows: readonly StoredReleaseAnalysis[],
  userAssets: readonly string[],
): Record<string, EcoResultAnalysis> {
  const sig = assetsSignature(userAssets);
  const byEvent = new Map<string, StoredReleaseAnalysis[]>();
  for (const r of rows) byEvent.set(r.eventName, [...(byEvent.get(r.eventName) ?? []), r]);
  const out: Record<string, EcoResultAnalysis> = {};
  for (const [eventName, list] of byEvent) {
    const exact = list.find((r) => r.assetsKey === sig);
    const row = exact ?? [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    let stored: { interpretation?: unknown; gap?: unknown };
    try {
      stored = JSON.parse(row.analysisJson) as { interpretation?: unknown; gap?: unknown };
    } catch {
      continue;
    }
    // Lecture tolérante (#920, conformité) : une ligne à l'ancien format portait un sentiment par
    // actif ; seuls l'interprétation et l'écart calculé (s'il existe) sont rendus, jamais réécrits.
    if (typeof stored.interpretation !== 'string') continue;
    const analysis: EcoResultAnalysis = {
      interpretation: stored.interpretation,
      gap: GAPS.has(stored.gap as string) ? (stored.gap as EcoResultAnalysis['gap']) : null,
    };
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
