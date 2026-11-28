import type { HelpKbEntry } from './kb-parse';

/**
 * Chatbot de support (#493) : recherche locale dans la base, sans IA. Fonctions PURES.
 * Score d'une fiche = somme, pour chaque mot-clé (ou le titre) présent dans la question normalisée, du nombre
 * de mots du mot-clé : une expression de plusieurs mots pèse plus qu'un mot isolé.
 */

/** Score minimal pour répondre avec une fiche sans IA. Surcharge : `HELP_KB_MATCH_MIN`. */
export const HELP_KB_MATCH_MIN = 2;

export const helpKbMatchMin = (): number => {
  const v = Number(process.env['HELP_KB_MATCH_MIN']);
  return Number.isFinite(v) && v > 0 ? v : HELP_KB_MATCH_MIN;
};

/** Minuscules, sans accents ni ponctuation, espaces simples. */
export function normalizeHelp(text: string): string {
  return ` ${text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, ' ')
    .trim()} `;
}

export interface HelpMatch {
  entry: HelpKbEntry;
  score: number;
}

/** Mots vides ignorés dans la comparaison mot à mot. */
const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'un', 'une', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'a', 'au', 'aux', 'en', 'et', 'je', 'j', 'l', 'd', 'c', 'est', 'il', 'on', 'pour', 'sur', 'avec', 'ce', 'ca', 'que', 'qui', 'quoi', 'comment']);

/** Même mot, à la conjugaison près : égalité pour un mot court, même racine (5 lettres) sinon. */
const sameWord = (a: string, b: string) => (a.length < 5 || b.length < 5 ? a === b : a.slice(0, 5) === b.slice(0, 5));

export function scoreEntry(question: string, entry: HelpKbEntry): number {
  const q = normalizeHelp(question);
  const words = q.trim().split(' ').filter((w) => w && !STOP.has(w));
  let score = 0;
  for (const kw of entry.keywords) {
    const k = normalizeHelp(kw);
    const kWords = k.trim().split(' ').filter((w) => w && !STOP.has(w));
    if (!kWords.length) continue;
    if (q.includes(k)) score += kWords.length;
    else if (kWords.every((kw2) => words.some((w) => sameWord(w, kw2)))) score += kWords.length - 0.5;
  }
  const title = normalizeHelp(entry.title).trim();
  if (title && q.includes(` ${title} `)) score += 3;
  return score;
}

/** Fiches triées par score décroissant (score > 0 seulement). */
export function rankEntries(question: string, entries: readonly HelpKbEntry[]): HelpMatch[] {
  return entries
    .map((entry) => ({ entry, score: scoreEntry(question, entry) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
}

/** Demande de conseil de trading : refus, sans IA. */
export function isTradingAdvice(question: string): boolean {
  const q = normalizeHelp(question);
  return [
    / dois je (acheter|vendre|prendre|entrer|sortir|shorter|couper) /,
    / (je|j) (achete|vends|prends|shorte|entre|sors) (ou|maintenant)/,
    / (quel|quelle) (setup|strategie|entree|sortie|actif|direction) /,
    / (long|short) ou (long|short) /,
    / (acheter|vendre) ou (acheter|vendre) /,
    / ce trade /,
    / ou mettre (mon )?(stop|tp|take profit|stop loss) /,
    / (va|vais|ca va) (monter|baisser|descendre) /,
    / conseil(s)? (de|en) (trading|investissement|bourse) /,
    / signal(s|aux)? (de|d) (trading|achat|vente) /,
  ].some((r) => r.test(q));
}

/** Tentative de détournement du rôle : refus, sans IA. */
export function isRoleHijack(question: string): boolean {
  const q = normalizeHelp(question);
  return [
    / (ignore|oublie|ignorez|oubliez) (tes|vos|les|toutes? les) (instructions|consignes|regles) /,
    / (tu es|tu es maintenant|desormais tu es|fais comme si tu etais|joue le role) /,
    / (prompt systeme|system prompt|tes instructions) /,
    / (ignore|forget) (all |your |the )?(previous )?(instructions|rules) /,
    / (you are now|act as|pretend) /,
    / (developer|dev) mode /,
  ].some((r) => r.test(q));
}

export const HELP_REFUSAL_ADVICE =
  "Je ne donne pas de conseil de trading : ni sur un trade, ni sur un setup, ni sur une direction. Tes décisions restent les tiennes.\n" +
  "Je peux t'aider sur MyTradingCoach : comptes, synchro Tradovate, séance, journal, plans.";

export const HELP_REFUSAL_ROLE =
  "Je suis l'assistant de support de MyTradingCoach et je m'en tiens à ça.\n" +
  "Pose-moi une question sur l'app : comptes, synchro Tradovate, séance, journal, plans.";

export const HELP_ESCALATE =
  "Je ne suis pas sûr de la réponse, je préfère te mettre en relation avec Grégory.\n" +
  "Clique sur « Parler à un humain » : tu reçois la réponse par e-mail.";

export const HELP_SIMULATED =
  "Réponse simulée : l'IA est éteinte sur cet environnement, aucune réponse générée.\n" +
  "Clique sur « Parler à un humain » pour une vraie réponse.";

/**
 * Garde-fou de sortie de l'IA : un montant (chiffre suivi de €, $, euros, dollars) absent du contexte fourni
 * est une invention. Renvoie la liste des montants inconnus.
 */
export function unknownAmounts(answer: string, context: string): string[] {
  const amounts = (s: string) =>
    [...s.matchAll(/(\d[\d\s.,]*)\s?(€|\$|euros?|dollars?)/gi)].map((m) => m[1].replace(/[\s.,]/g, '')).filter(Boolean);
  const known = new Set(amounts(context));
  // Un nombre nu du contexte (« 49 » rendu sans symbole) compte aussi.
  for (const n of context.match(/\d[\d\s.,]*/g) ?? []) known.add(n.replace(/[\s.,]/g, ''));
  return amounts(answer).filter((a) => !known.has(a));
}
