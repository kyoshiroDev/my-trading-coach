/**
 * Contenu d'un push. JAMAIS de donnée sensible : pas d'e-mail, pas de montant, pas de token.
 * Titre court et neutre ; le détail se lit dans l'admin (`url`, ouverte au clic).
 */
export interface AdminPushMessage {
  title: string;
  body: string;
  /** Chemin de l'admin ouvert au clic (relatif à la racine du domaine de l'admin). */
  url: string;
  /** Regroupe les notifications d'un même type (la dernière remplace la précédente). */
  tag: string;
  urgency: 'high' | 'normal';
}

/** Messages des événements business, prêts à l'emploi pour `AdminNotifier.notify`. */
export const ADMIN_PUSH_MESSAGES = {
  premiumSubscription: (trial: boolean): AdminPushMessage => ({
    title: trial ? 'Nouvel essai Premium' : 'Nouvel abonnement Premium',
    body: "Ouvre l'admin pour le détail.",
    url: '/subscriptions',
    tag: 'premium',
    urgency: 'normal',
  }),
  premiumPayment: (): AdminPushMessage => ({
    title: 'Paiement Premium reçu',
    body: "Ouvre l'admin pour le détail.",
    url: '/revenue',
    tag: 'premium-payment',
    urgency: 'normal',
  }),
  paymentFailed: (): AdminPushMessage => ({
    title: 'Paiement échoué',
    body: 'Un paiement Premium a échoué.',
    url: '/subscriptions',
    tag: 'billing',
    urgency: 'high',
  }),
  subscriptionCanceled: (): AdminPushMessage => ({
    title: 'Annulation',
    body: 'Un abonnement Premium a pris fin.',
    url: '/subscriptions',
    tag: 'billing',
    urgency: 'normal',
  }),
  ambassadorRequest: (): AdminPushMessage => ({
    title: "Nouvelle demande d'ambassadeur",
    body: "Ouvre l'admin pour la consulter.",
    url: '/ambassadeurs',
    tag: 'ambassador',
    urgency: 'normal',
  }),
  signup: (): AdminPushMessage => ({
    title: 'Nouvelle inscription',
    body: "Un compte vient d'être créé.",
    url: '/users',
    tag: 'signup',
    urgency: 'normal',
  }),
  tradovateReconnect: (): AdminPushMessage => ({
    title: 'Une connexion Tradovate a expiré',
    body: "L'utilisateur doit reconnecter son compte.",
    url: '/brokers',
    tag: 'tradovate',
    urgency: 'normal',
  }),
  test: (): AdminPushMessage => ({
    title: 'Notification de test',
    body: 'Les notifications de MTC Admin fonctionnent sur cet appareil.',
    url: '/notifications',
    tag: 'test',
    urgency: 'normal',
  }),
} satisfies Record<string, (...args: never[]) => AdminPushMessage>;

export const PUSH_ICON = '/icons/icon-192.png';

/**
 * Payload compris par @angular/service-worker : il affiche `notification` et, au clic, applique
 * `data.onActionClick.default` (ouvre ou focalise l'admin sur `url`). Repris de xmr-trader.
 */
export function angularPushPayload(message: AdminPushMessage, nowMs: number) {
  const open = { operation: 'navigateLastFocusedOrOpen' as const, url: message.url };
  return {
    notification: {
      title: message.title,
      body: message.body,
      icon: PUSH_ICON,
      badge: PUSH_ICON,
      tag: message.tag,
      renotify: true,
      timestamp: nowMs,
      lang: 'fr',
      data: { url: message.url, onActionClick: { default: open } },
    },
  };
}
