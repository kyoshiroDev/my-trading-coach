/**
 * Campagnes et sources de TEST (#1029), exclues par défaut des chiffres de l'admin Acquisition
 * (visites, parcours, inscrits, engagement) ; l'interrupteur « Inclure les tests » les remet.
 * Les données restent en base : on filtre seulement dans les requêtes.
 *
 * Une seule liste, appliquée à la source, au medium ET à la campagne, sans casse :
 * - motif sans `*` = valeur EXACTE (`ami` ne retire ni `amis-trading` ni `miami`) ;
 * - `*` final = préfixe (`test-*` retire `test-greg4`, jamais `contest` ni `latest-promo`).
 * Jamais de « contient ». Une seule règle : appliquée en SQL par `notTestAcquisitionSql` (API,
 * `common/stats/test-acquisition.ts`), vérifiée sur une vraie base par son int-spec.
 * Ajouter une campagne de test = ajouter un motif ici (et une ligne dans
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
