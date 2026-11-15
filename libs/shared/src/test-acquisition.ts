import type { AcquisitionUtm } from './acquisition-filter';

/**
 * Campagnes et sources de TEST (#1029), exclues par défaut des chiffres de l'admin Acquisition
 * (visites, parcours, inscrits, engagement) ; l'interrupteur « Inclure les tests » les remet.
 * Les données restent en base : on filtre seulement dans les requêtes.
 *
 * Une seule liste, appliquée à la source, au medium ET à la campagne, sans casse :
 * - motif sans `*` = valeur EXACTE (`ami` ne retire ni `amis-trading` ni `miami`) ;
 * - `*` final = préfixe (`test-*` retire `test-greg4`, jamais `contest` ni `latest-promo`).
 * Jamais de « contient ». Ajouter une campagne de test = ajouter un motif ici (et une ligne dans
 * `.claude/decisions.md`).
 */
export const TEST_ACQUISITION_PATTERNS = ['test', 'test-*', 'ami'] as const;

/** Motif → `LIKE` SQL : `\`, `_` et `%` échappés (jokers littéraux), puis `*` final → `%`. */
export function testPatternToLike(pattern: string): string {
  const lower = pattern.toLowerCase();
  const prefix = lower.endsWith('*');
  const body = (prefix ? lower.slice(0, -1) : lower).replace(/[\\_%]/g, (c) => `\\${c}`);
  return prefix ? `${body}%` : body;
}

/** Vrai si la valeur (source, medium ou campagne) correspond à un motif de test. */
export function isTestAcquisitionValue(value: string | null | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  if (!v) return false;
  return TEST_ACQUISITION_PATTERNS.some((p) => (p.endsWith('*') ? v.startsWith(p.slice(0, -1)) : v === p));
}

/** Vrai si la source, le medium ou la campagne est un test. */
export function isTestAcquisition(utm: Partial<AcquisitionUtm>): boolean {
  return [utm.source, utm.medium, utm.campaign].some(isTestAcquisitionValue);
}
