/**
 * Événements d'usage de l'app (liste blanche), rattachés au compte et partagés par l'API et l'admin.
 * Conservés 13 mois (`RetentionCron`, purge quotidienne) et effacés avec le compte (cascade).
 *
 * Entonnoir Premium :
 * - `premium_seen`     : un cadenas / teaser Premium s'affiche (une fois par écran et par session)
 * - `plan_modal_open`  : la modale des offres s'ouvre
 * - `trial_click`      : clic « Essayer » / « Passer Premium » dans la modale (départ vers Stripe)
 * - `checkout_return`  : retour de Stripe (`place` = `success` ou `canceled`)
 * - `demo_open`        : connexion au compte démo (enregistré côté API)
 * - `demo_signup_click`: clic « Créer mon compte » depuis la démo
 *
 * Installation de l'app (`place` = plateforme, `INSTALL_PLACES`) :
 * - `install_shown`  : la feuille d'installation s'affiche (une fois par session)
 * - `install_click`  : « Installer » (Android, ordinateur) ou « Je l'ai fait » (iPhone)
 * - `install_done`   : installation confirmée par le navigateur, ou premier lancement depuis
 *                      l'écran d'accueil (une fois par appareil)
 * - `install_later`  : « Plus tard »
 * - `install_never`  : « Ne plus me proposer »
 * - `inapp_seen`     : message « Ouvre dans ton navigateur » (Instagram, TikTok…), une fois par session
 * - `push_enabled`   : alertes activées sur cet appareil (permission accordée)
 * - `push_denied`    : permission refusée ou demande fermée
 */
export const PRODUCT_EVENTS = [
  'premium_seen',
  'plan_modal_open',
  'trial_click',
  'checkout_return',
  'demo_open',
  'demo_signup_click',
  'install_shown',
  'install_click',
  'install_done',
  'install_later',
  'install_never',
  'inapp_seen',
  'push_enabled',
  'push_denied',
] as const;
export type ProductEvent = (typeof PRODUCT_EVENTS)[number];

/** Événements de l'installation, comptés par plateforme dans l'admin. */
export const INSTALL_EVENTS = [
  'install_shown',
  'install_click',
  'install_done',
  'install_later',
  'install_never',
  'inapp_seen',
  'push_enabled',
  'push_denied',
] as const satisfies readonly ProductEvent[];

/** `ios-other` : iPhone sur un autre navigateur que Safari (Chrome, Firefox), qui ne peut pas installer. */
export const INSTALL_PLACES = ['android', 'ios', 'ios-other', 'desktop'] as const;
