/**
 * Événements de l'entonnoir Premium (liste blanche) — partagés par l'API et l'admin.
 * - `premium_seen`     : un cadenas / teaser Premium s'affiche (une fois par écran et par session)
 * - `plan_modal_open`  : la modale des offres s'ouvre
 * - `trial_click`      : clic « Essayer » / « Passer Premium » dans la modale (départ vers Stripe)
 * - `checkout_return`  : retour de Stripe (`place` = `success` ou `canceled`)
 * - `demo_open`        : connexion au compte démo (enregistré côté API)
 * - `demo_signup_click`: clic « Créer mon compte » depuis la démo
 */
export const PRODUCT_EVENTS = [
  'premium_seen',
  'plan_modal_open',
  'trial_click',
  'checkout_return',
  'demo_open',
  'demo_signup_click',
] as const;
export type ProductEvent = (typeof PRODUCT_EVENTS)[number];
