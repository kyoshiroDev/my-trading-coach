import type { AdminPushEvent } from './enums';

/** GET /admin/push/public-key — `enabled: false` quand le serveur n'a pas de clés VAPID. */
export interface AdminPushPublicKey {
  enabled: boolean;
  publicKey: string | null;
}

/** Corps de POST /admin/push/subscribe : `PushSubscription.toJSON()` du navigateur. */
export interface AdminPushSubscriptionInput {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}

/** État de CET appareil (identifié par son endpoint). */
export interface AdminPushDevice {
  subscribed: boolean;
  mutedEvents: AdminPushEvent[];
}

/** POST /admin/push/test : bilan de l'envoi vers tous les appareils ADMIN abonnés. */
export interface AdminPushTestResult {
  subscriptions: number;
  delivered: number;
  failed: number;
  removed: number;
}

/** Libellés des événements (page Notifications de l'admin). */
export const ADMIN_PUSH_EVENT_LABELS: Record<AdminPushEvent, string> = {
  PREMIUM: 'Nouvel abonnement ou paiement Premium',
  BILLING_ISSUE: 'Paiement échoué ou annulation',
  AMBASSADOR_REQUEST: "Demande d'ambassadeur",
  SIGNUP: 'Nouvelle inscription',
  TRADOVATE_RECONNECT: 'Connexion Tradovate expirée',
};
