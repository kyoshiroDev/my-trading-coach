/**
 * Tickets de pénalité Tradovate : un HTTP 200 dont le corps porte `p-ticket`, `p-time` et parfois
 * `p-captcha` à la place des données (docs/tradovate-api-capabilities.md, §7).
 *
 * Ce n'est ni un refus de jeton, ni une réponse vide. Avec `p-captcha: true`, la doc précise que
 * l'opération ne peut plus être retentée depuis une application tierce. Le contenu du ticket
 * n'est jamais conservé ni journalisé.
 */

/** `p-time` absent ou illisible : valeur sûre, le délai annoncé par la doc pour une limite de débit. */
export const PENALTY_DEFAULT_S = 60 * 60;
/** Garde-fou contre un `p-time` aberrant : la pause reste bornée. */
export const PENALTY_MAX_S = 24 * 60 * 60;
/** Captcha : aucune nouvelle tentative avant ce délai, quel que soit `p-time`. */
export const PENALTY_CAPTCHA_S = 24 * 60 * 60;

export interface TradovatePenalty {
  /** Durée de la pause, en secondes. */
  seconds: number;
  /** `true` : opération non retentable depuis l'application. */
  captcha: boolean;
}

function isCaptcha(value: unknown): boolean {
  return value === true || value === 'true';
}

/** La pénalité portée par un corps de réponse, ou `null` s'il n'y en a pas. */
export function readPenalty(body: unknown): TradovatePenalty | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const obj = body as Record<string, unknown>;
  const captcha = isCaptcha(obj['p-captcha']) || isCaptcha(obj['captcha']);
  if (!captcha && !('p-ticket' in obj) && !('p-time' in obj) && !('p-captcha' in obj)) return null;
  if (captcha) return { seconds: PENALTY_CAPTCHA_S, captcha: true };
  const time = Number(obj['p-time']);
  const seconds = Number.isFinite(time) && time > 0 ? Math.min(Math.ceil(time), PENALTY_MAX_S) : PENALTY_DEFAULT_S;
  return { seconds, captcha: false };
}
