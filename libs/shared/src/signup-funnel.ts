/**
 * Parcours d'inscription par source (landing → app → paiement), mesuré SANS cookie ni donnée
 * personnelle : uniquement des compteurs agrégés (`FunnelEventDaily`). Listes FERMÉES partagées par
 * la landing, l'app, l'API et l'admin : une valeur hors liste n'est jamais stockée.
 */

/**
 * Étapes envoyées à `POST /public/funnel`, dans l'ordre du parcours. La visite (`landing_view`)
 * n'en fait pas partie : elle reste comptée par `POST /public/visit` (`LandingVisitDaily`).
 */
export const SIGNUP_FUNNEL_STEPS = [
  'cta_click',
  'register_view',
  'register_submit',
  'register_success',
  'register_error',
  'checkout_redirect',
] as const;
export type SignupFunnelStep = (typeof SIGNUP_FUNNEL_STEPS)[number];

/** Carte ou bouton d'inscription cliqué sur la landing (`data-cta`). */
export const SIGNUP_FUNNEL_CTAS = ['founder', 'free', 'premium'] as const;
export type SignupFunnelCta = (typeof SIGNUP_FUNNEL_CTAS)[number];

/** Offre vers laquelle part le paiement. */
export const SIGNUP_FUNNEL_CHECKOUT_PLANS = ['founder', 'premium'] as const;

/** Codes d'erreur d'inscription normalisés (jamais le message brut). */
export const SIGNUP_FUNNEL_ERRORS = ['email_taken', 'validation', 'network', 'server', 'other'] as const;
export type SignupFunnelError = (typeof SIGNUP_FUNNEL_ERRORS)[number];

const DETAILS: Partial<Record<SignupFunnelStep, readonly string[]>> = {
  cta_click: SIGNUP_FUNNEL_CTAS,
  checkout_redirect: SIGNUP_FUNNEL_CHECKOUT_PLANS,
  register_error: SIGNUP_FUNNEL_ERRORS,
};

/**
 * `detail` autorisé pour une étape : valeur de sa liste blanche, sinon `''`. Une erreur
 * d'inscription sans code reconnu devient `other` (elle reste comptée comme erreur).
 */
export function signupFunnelDetail(step: SignupFunnelStep, detail: string | null | undefined): string {
  const allowed = DETAILS[step];
  if (!allowed) return '';
  const value = (detail ?? '').trim().toLowerCase();
  if (allowed.includes(value)) return value;
  return step === 'register_error' ? 'other' : '';
}

/**
 * Navigateur intégré d'une app (Instagram, Facebook / Messenger, TikTok, LINE) : source du motif,
 * partagée telle quelle avec le script inline de la landing (qui ne peut rien importer).
 */
export const IN_APP_UA_PATTERN = 'Instagram|FBAN|FBAV|FB_IAB|FBIOS|TikTok|musical_ly|Line/';

const IN_APP_UA = new RegExp(IN_APP_UA_PATTERN, 'i');

/** Vrai dans le navigateur intégré d'Instagram, Facebook, TikTok ou LINE. Seul ce booléen est envoyé. */
export function isInAppBrowser(userAgent: string | null | undefined): boolean {
  return IN_APP_UA.test(userAgent ?? '');
}

/** Clé localStorage du mode interne (`?internal=1`) : plus aucune visite ni étape envoyée. */
export const INTERNAL_STORAGE_KEY = 'mtc_internal';

/**
 * Mode interne d'après l'URL : `?internal=1` → `true`, `?internal=0` → `false`, sinon `null`
 * (garder l'état mémorisé).
 */
export function internalFlagFromSearch(search: string): boolean | null {
  const v = new URLSearchParams(search).get('internal');
  return v === '1' ? true : v === '0' ? false : null;
}
