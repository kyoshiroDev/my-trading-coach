import type { Logger } from '@nestjs/common';

/**
 * Garde-fou de conformité des textes de l'IA (#881) : aucune promesse de gain, aucune prévision de
 * résultat, aucune consigne d'achat ou de vente, aucun jugement « gagnant / perdant » du trader.
 * Appliqué à TOUT texte d'IA avant affichage ou envoi : une régénération au plus, puis repli sur un
 * texte neutre. Les détections sont comptées dans les journaux, jamais le contenu.
 *
 * Insensible à la casse et aux accents, sauf là où l'accent change le sens (« sûr » / « sur »,
 * « entre sur » / « entré sur »). Faux positifs écartés exprès :
 *  - « trade gagnant », « série perdante » : décrivent un trade, pas le trader ;
 *  - « bien sûr », « sur » ; « assure-toi de… » (consigne de discipline) ;
 *  - une négation (« aucun gain n'est garanti », « rien n'est assuré ») : c'est le rappel voulu ;
 *  - « tu vends trop tôt » (description d'un comportement) : seul l'impératif est visé.
 */

/** Texte neutre de repli, au passé et sans promesse. */
export const AI_TEXT_FALLBACK =
  "D'après tes trades enregistrés, ce point n'a pas pu être formulé de façon fiable. Ces analyses décrivent le passé et restent indicatives.";

interface ForbiddenPattern {
  /** Identifiant écrit dans les journaux (jamais le texte détecté). */
  id: string;
  re: RegExp;
  /** Cherché sur le texte en minuscules AVEC accents (sinon : sans accents). */
  accents?: boolean;
  /** Ignoré si une négation précède de peu (« aucun gain n'est garanti »). */
  negatable?: boolean;
}

const PATTERNS: ForbiddenPattern[] = [
  { id: 'rentable', re: /\brentab\w*/ },
  { id: 'profitable', re: /\bprofitab\w*/ },
  { id: 'edge', re: /\bedges?\b/ },
  { id: 'avantage-statistique', re: /\bavantages? statistiques?\b/ },
  { id: 'garanti', re: /\bgaranti\w*/, negatable: true },
  { id: 'assure', re: /\b(gains?|resultats?|reussites?|profits?|succes|benefices?)\b[^.!?]{0,30}\bassure(e|es|s)?\b/, negatable: true },
  { id: 'sur', re: /(à coup sûr|\bc'est sûr\b|\b(gain|résultat|réussite|profit)s? (est |sont )?sûrs?\b|\bsûr de (gagner|réussir|passer|valider))/, accents: true, negatable: true },
  { id: 'faire-gagner', re: /\b(va|vont|vas) te faire gagner\b|\bte fera gagner\b/ },
  { id: 'futur', re: /\btu (vas|seras|feras|gagneras|reussiras|passeras|atteindras|valideras|perdras)\b/ },
  { id: 'taux-de-reussite', re: /\bamelior\w* (ton|tes|votre|vos|le|ta) (taux de reussite|win ?rate)\b/ },
  { id: 'optimiser-gains', re: /\boptimis\w* (tes|ton|vos|votre|les) (gains?|profits?|benefices?|rendements?)\b/ },
  { id: 'achat-vente', re: /(?<!\b(tu|je|il|elle|on|qui|ils|elles)\s)(?<!\bj')\b(achete|achetez|vends|vendez)\b/ },
  { id: 'entre-sur', re: /\b(entre|entrez) (sur|long|short|en position)\b|\bprends? (ce trade|position)\b|\bpasse (long|short)\b/, accents: true },
  { id: 'trader-gagnant', re: /\b(tu es|t'es|tu deviens|tu restes|tu seras|un trader|profil|mentalite( de)?|etre un) (un |une )?(gagnant|perdant|gagneur|perdeur)e?s?\b/ },
];

const NEGATION = /\b(aucun|aucune|ne|pas|jamais|ni|rien|non|sans)\b|\bn'/;

/** Minuscules, apostrophes droites ; `stripAccents` retire les diacritiques. */
function normalize(text: string, stripAccents: boolean): string {
  const lower = text.toLowerCase().replace(/[’ʼ`]/g, "'");
  return stripAccents ? lower.normalize('NFD').replace(/[̀-ͯ]/g, '') : lower;
}

/** Identifiants des motifs proscrits trouvés dans `text` (vide = conforme). */
export function findForbiddenTerms(text: string): string[] {
  if (!text) return [];
  const plain = normalize(text, true);
  const accented = normalize(text, false);
  const found: string[] = [];
  for (const p of PATTERNS) {
    const haystack = p.accents ? accented : plain;
    const re = new RegExp(p.re.source, 'g');
    for (let m = re.exec(haystack); m; m = re.exec(haystack)) {
      if (p.negatable) {
        // Les quelques mots qui précèdent, dans la même phrase.
        const before = haystack.slice(Math.max(0, m.index - 40), m.index).split(/[.!?]/).pop() ?? '';
        if (NEGATION.test(normalize(before, true))) continue;
      }
      found.push(p.id);
      break;
    }
  }
  return found;
}

/** Applique `fn` à chaque chaîne d'une valeur (texte simple, objet ou tableau JSON). */
function mapStrings<T>(value: T, fn: (s: string) => string): T {
  if (typeof value === 'string') return fn(value) as T;
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)])) as T;
  }
  return value;
}

/** Motifs proscrits de toutes les chaînes d'une valeur, sans doublon. */
export function findForbiddenInValue(value: unknown): string[] {
  const ids = new Set<string>();
  mapStrings(value, (s) => {
    for (const id of findForbiddenTerms(s)) ids.add(id);
    return s;
  });
  return [...ids];
}

/** Remplace chaque chaîne non conforme par le texte neutre (les autres restent intactes). */
export function neutralizeValue<T>(value: T, fallback = AI_TEXT_FALLBACK): T {
  return mapStrings(value, (s) => (findForbiddenTerms(s).length ? fallback : s));
}

/**
 * Produit un texte d'IA conforme : `produce` une fois, une seconde fois si un motif est détecté,
 * puis repli sur le texte neutre pour les seules chaînes encore non conformes. Journalise le nombre
 * de détections et les identifiants des motifs, jamais le texte.
 */
export async function guardAiText<T>(
  feature: string,
  produce: () => Promise<T>,
  logger: Pick<Logger, 'warn'>,
  fallback = AI_TEXT_FALLBACK,
): Promise<T> {
  const first = await produce();
  const ids = findForbiddenInValue(first);
  if (ids.length === 0) return first;
  logger.warn(`Garde-fou IA (${feature}) : ${ids.length} motif(s) proscrit(s) [${ids.join(', ')}], régénération.`);

  const second = await produce();
  const again = findForbiddenInValue(second);
  if (again.length === 0) return second;
  logger.warn(`Garde-fou IA (${feature}) : ${again.length} motif(s) encore présent(s) [${again.join(', ')}], repli sur le texte neutre.`);
  return neutralizeValue(second, fallback);
}
