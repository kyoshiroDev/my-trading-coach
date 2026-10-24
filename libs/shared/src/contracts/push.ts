import type { PushAlertType } from './enums';

/**
 * Notifications push des traders (#666). Les routes sont sous `/push`. Le corps d'abonnement et le
 * bilan d'envoi ont la même forme que ceux de l'admin (`AdminPushSubscriptionInput`,
 * `AdminPushTestResult`).
 */

/** Fuseau des heures silencieuses : aucun fuseau n'est enregistré par utilisateur. */
export const PUSH_TIME_ZONE = 'Europe/Paris';

/** Types réservés au Premium (les alertes qu'ils relaient le sont déjà). `CONNECTION` reste gratuit. */
export const PUSH_PREMIUM_TYPES: readonly PushAlertType[] = ['PROP_RULES', 'BEHAVIOR', 'RECAP'];

/** Appareils gardés par trader : au-delà, le plus ancien est remplacé à l'abonnement. */
export const PUSH_MAX_DEVICES = 10;

/** Types coupés tant que le trader n'a rien réglé. */
export const DEFAULT_MUTED_PUSH_TYPES: readonly PushAlertType[] = ['RECAP'];

/** Libellés des types (section Notifications du profil). */
export const PUSH_ALERT_TYPE_LABELS: Record<PushAlertType, string> = {
  PROP_RULES: 'Règles prop firm',
  BEHAVIOR: 'Comportement',
  RECAP: 'Récap du jour',
  CONNECTION: 'Connexion Tradovate',
};

/** Heures silencieuses, en minutes depuis minuit (0 à 1439), heure de `PUSH_TIME_ZONE`. */
export interface PushQuietHours {
  start: number;
  end: number;
}

/** Un appareil abonné, tel qu'affiché dans le profil (l'endpoint n'est jamais renvoyé). */
export interface TraderPushDeviceView {
  id: string;
  /** « Chrome · Android », « Safari · iPhone »… déduit du navigateur à l'abonnement. */
  label: string;
  createdAt: string;
  lastSuccessAt: string | null;
}

/** GET /push/settings */
export interface TraderPushSettings {
  /** `false` quand le serveur n'a pas de clés VAPID : rien ne peut être activé. */
  enabled: boolean;
  publicKey: string | null;
  mutedTypes: PushAlertType[];
  quietHours: PushQuietHours | null;
  timeZone: string;
  devices: TraderPushDeviceView[];
}

/** POST /push/device : CET appareil (identifié par son endpoint) est-il abonné ? */
export interface TraderPushDeviceState {
  subscribed: boolean;
  id: string | null;
}

/** PATCH /push/preferences : champ absent = inchangé ; `quietHours: null` = désactivées. */
export interface TraderPushPreferencesInput {
  mutedTypes?: PushAlertType[];
  quietHours?: PushQuietHours | null;
}

/** Contenu d'un push reçu par le service worker de l'app. */
export interface TraderPushPayload {
  title: string;
  body: string;
  /** Chemin de l'app ouvert au clic. */
  url: string;
  /** Regroupe les notifications d'un même sujet : la dernière remplace la précédente. */
  tag: string;
  timestamp: number;
  /** Chemin des réglages (action « Réglages », là où la plateforme affiche des actions). */
  settingsUrl: string;
}
