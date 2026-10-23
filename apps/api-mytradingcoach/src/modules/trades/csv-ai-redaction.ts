import { splitCsvLine } from './csv-parsers';

/**
 * Ce qui part vers l'IA d'un fichier de broker inconnu (mapping et repli ligne par ligne) : les
 * VALEURS d'identification sont masquées, le reste est intact. Fonctions PURES, testées seules.
 *
 * - En-tête gardé tel quel : le modèle en a besoin pour reconnaître les colonnes.
 * - Colonne d'identification (compte, client, nom, e-mail, identifiants d'ordre ou de trade,
 *   reconnue par son en-tête) : chaque valeur devient un jeton stable dans le fichier
 *   (`compte-1`, `id-3`…). Même valeur, même jeton : les lignes d'un même ordre restent
 *   rapprochables, sans rien révéler.
 * - Autres cellules : adresses e-mail et longues suites de chiffres dans un texte (numéro de
 *   compte cité dans une description) masquées. Une cellule purement numérique (prix, quantité,
 *   horodatage) et une date compacte (`20241023…`) ne sont jamais touchées.
 * Le nombre de colonnes est conservé : les index du mapping restent justes.
 */

const SEPARATORS = [',', ';', '\t', '|'] as const;

/** Séparateur de l'en-tête : celui qui découpe en le plus de colonnes (au moins 2), sinon la virgule. */
export function detectDelimiter(header: string): string {
  let best = ',';
  let max = 1;
  for (const sep of SEPARATORS) {
    const n = splitCsvLine(header, sep).length;
    if (n > max) {
      max = n;
      best = sep;
    }
  }
  return best;
}

const norm = (h: string) =>
  h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Familles de colonnes d'identification, reconnues par l'en-tête normalisé. */
const ID_HEADERS: { kind: 'compte' | 'personne' | 'email' | 'id'; re: RegExp }[] = [
  { kind: 'compte', re: /^(account|acct|compte|konto|cuenta)( ?(id|no|nr|number|num|numero|name|nom|code|ref))?$/ },
  { kind: 'compte', re: /^(n|no|num|numero) (de )?compte$/ },
  { kind: 'personne', re: /^(client|customer|user|login|owner|trader|username|utilisateur|titulaire|holder)( ?(id|name|nom|no|number|code))?$/ },
  // « Name » seul désigne souvent l'instrument (« Name » + « Ticker ») : seulement les noms explicites.
  { kind: 'personne', re: /^(full name|first name|last name|prenom|nom complet|nom prenom)$/ },
  { kind: 'email', re: /^(e ?mail|courriel|mail)( address| adresse)?$/ },
  { kind: 'id', re: /^(order|deal|ticket|position|trade|execution|exec|fill|transaction|txn)( ?(id|no|nr|number|num|ref|reference))?$/ },
  { kind: 'id', re: /^(id|uid|uuid)$/ },
];

/** Famille d'identification d'un en-tête de colonne, `null` si la colonne est utile au parsing. */
export function identificationKind(header: string): 'compte' | 'personne' | 'email' | 'id' | null {
  const h = norm(header);
  // `trade`, `position` ou `order` seuls désignent souvent le sens ou le type : identifiant
  // seulement avec un suffixe d'id ou un `#` (« Order # »).
  if (/^(order|deal|position|trade|execution|exec|fill|transaction|txn)$/.test(h)) return header.includes('#') ? 'id' : null;
  return ID_HEADERS.find((x) => x.re.test(h))?.kind ?? null;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const LONG_DIGITS = /\d{7,}/g;
const NUMERIC_CELL = /^[-+]?[\d\s.,]+$/;
/** `AAAAMMJJ`, éventuellement suivi de `hhmm` ou `hhmmss` : une date, pas un identifiant. */
const COMPACT_DATE = /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(\d{4}|\d{6})?$/;

/** Masque e-mails et longues suites de chiffres d'une cellule de texte ; nombres et dates intacts. */
export function scrubCell(cell: string): string {
  const out = cell.replace(EMAIL, '[email]');
  if (NUMERIC_CELL.test(out)) return out;
  return out.replace(LONG_DIGITS, (d) => (COMPACT_DATE.test(d) ? d : '[num]'));
}

const quote = (cell: string, sep: string) =>
  cell.includes(sep) || cell.includes('"') || cell.includes('\n') ? `"${cell.replace(/"/g, '""')}"` : cell;

/**
 * Lignes à envoyer à l'IA (en-tête en premier, gardé tel quel). À appeler UNE fois sur toutes
 * les lignes envoyées, pour que les jetons restent stables d'un lot à l'autre.
 */
export function redactForAi(lines: string[]): string[] {
  if (!lines.length) return lines;
  const [header, ...rows] = lines;
  const sep = detectDelimiter(header);
  const kinds = splitCsvLine(header, sep).map(identificationKind);
  const tokens = kinds.map(() => new Map<string, string>());
  return [
    header,
    ...rows.map((line) =>
      splitCsvLine(line, sep)
        .map((cell, i) => {
          const kind = kinds[i];
          if (!kind) return quote(scrubCell(cell), sep);
          if (!cell) return cell;
          const seen = tokens[i];
          if (!seen.has(cell)) seen.set(cell, `${kind}-${seen.size + 1}`);
          return seen.get(cell)!;
        })
        .join(sep),
    ),
  ];
}
