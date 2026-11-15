/**
 * Bandeau d'inscription de la démo (#1029) : placements des clics, origine de la visite et lien
 * vers /register. Partagé par l'app (bandeau, pastille, relance) et l'API (liste blanche des
 * `place` de `demo_cta_click`, compteurs de l'admin).
 */

/**
 * Où le visiteur a cliqué « Créer mon compte » :
 * - `banner` : bandeau fixe en bas de la démo ;
 * - `pill`   : pastille du bandeau réduit ;
 * - `modal`  : relance unique (60 s ou 3 pages) ;
 * - `action` : fenêtre ouverte par une action bloquée en démo (403 « mode démo »).
 */
export const DEMO_CTA_PLACEMENTS = ['banner', 'pill', 'modal', 'action'] as const;
export type DemoCtaPlacement = (typeof DEMO_CTA_PLACEMENTS)[number];

/** `source=demo` sur le lien d'inscription, et `utm_source` par défaut quand la visite n'en a pas. */
export const DEMO_SIGNUP_SOURCE = 'demo';

/** Paramètres d'origine gardés de l'arrivée sur /demo (UTM de la landing ou du lien, parrain). */
export interface DemoOrigin {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  ref?: string;
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;

/** Origine lue dans l'URL d'arrivée : UTM (≤ 100 car.) et code parrain (lettres, chiffres, tirets). */
export function demoOriginFromSearch(search: string): DemoOrigin {
  const params = new URLSearchParams(search);
  const origin: DemoOrigin = {};
  for (const k of UTM_KEYS) {
    const v = (params.get(k) ?? '').trim().slice(0, 100);
    if (v) origin[k] = v;
  }
  const ref = (params.get('ref') ?? '').trim();
  if (/^[A-Za-z0-9_-]{1,40}$/.test(ref)) origin.ref = ref;
  return origin;
}

/**
 * Paramètres du lien /register depuis la démo : origine de la visite telle quelle, `source=demo`
 * toujours, et `utm_source=demo` seulement si la visite n'avait aucun UTM (une inscription venue de
 * la newsletter reste attribuée à la newsletter).
 */
export function demoRegisterParams(origin: DemoOrigin): Record<string, string> {
  const params: Record<string, string> = {};
  const hasUtm = UTM_KEYS.some((k) => origin[k]);
  if (hasUtm) {
    for (const k of UTM_KEYS) if (origin[k]) params[k] = origin[k] as string;
  } else {
    params['utm_source'] = DEMO_SIGNUP_SOURCE;
  }
  if (origin.ref) params['ref'] = origin.ref;
  params['source'] = DEMO_SIGNUP_SOURCE;
  return params;
}
