import type {
  GiveawayActivation,
  GiveawayDisplayConsent,
  GiveawayModeration,
  GiveawayPool,
  GiveawayPublication,
} from './enums';

/**
 * Tirage au sort mensuel (PROMPT-tirage-mensuel) : formes JSON échangées entre l'API et l'admin.
 * Dates en ISO.
 */

/** État d'un des deux tirages dans l'onglet admin « Tirages ». */
export interface AdminGiveawayPoolState {
  pool: GiveawayPool;
  enabled: boolean;
  enabledAt: string | null;
  /** Annonce déjà envoyée pour l'activation en cours. */
  announcedAt: string | null;
  /** Éligibles si le tirage avait lieu maintenant (activité du mois civil écoulé). */
  eligibleNow: number;
  /** Destinataires réels de l'e-mail d'annonce (consentement marketing déjà filtré). */
  announceAudience: number;
}

/** Une ligne de l'historique : un tirage et son lot éventuel. */
export interface AdminGiveawayDrawRow {
  drawId: string;
  /** Mois du tirage (« 2027-02 » pour le tirage du 1er février 2027). */
  period: string;
  pool: GiveawayPool;
  drawnAt: string;
  eligibleCount: number;
  /** Trace d'audit : sha256 de la liste triée des éligibles et rang tiré. */
  eligibleHash: string;
  drawnIndex: number | null;
  win: AdminGiveawayWin | null;
}

export interface AdminGiveawayWin {
  id: string;
  /** Null = compte supprimé depuis. */
  userId: string | null;
  email: string | null;
  /** Nom affiché selon l'accord (« Un trader » sans accord). */
  displayName: string;
  prizeMonths: number;
  startsAt: string;
  endsAt: string;
  activationStatus: GiveawayActivation;
  activationError: string | null;
  /** Avoir Stripe du lot Premium (centimes). */
  creditCents: number | null;
  displayConsent: GiveawayDisplayConsent;
  message: string | null;
  moderation: GiveawayModeration;
  instagramConsent: boolean;
  instagramHandle: string | null;
  publicationStatus: GiveawayPublication;
  publishedUrl: string | null;
}

/** `GET /admin/giveaway`. */
export interface AdminGiveawayData {
  free: AdminGiveawayPoolState;
  premium: AdminGiveawayPoolState;
  nextDrawAt: string;
  /** « Tirer maintenant » disponible (hors prod et `GIVEAWAY_MANUAL_DRAW=true`). */
  manualDrawAvailable: boolean;
  /** Allumer un tirage est possible (toujours hors prod ; en prod, seulement à partir du lot B). */
  activationAvailable: boolean;
  history: AdminGiveawayDrawRow[];
}

/** `PATCH /admin/giveaway/settings` : état du tirage et nombre d'annonces mises en file. */
export interface AdminGiveawaySettingsResponse {
  state: AdminGiveawayPoolState;
  /** Annonces mises en envoi (0 à l'extinction ou si déjà annoncé pour cette activation). */
  announcementsQueued: number;
}

/** `PATCH /admin/giveaway/settings` : corps. */
export interface UpdateGiveawaySettingsRequest {
  pool: GiveawayPool;
  enabled: boolean;
}

/** `PATCH /admin/giveaway/wins/:id/moderation` : corps (réponse : la ligne `AdminGiveawayWin` à jour). */
export interface ModerateGiveawayWinRequest {
  moderation: Exclude<GiveawayModeration, 'EN_ATTENTE'>;
}

/** `POST /admin/giveaway/draw` (hors prod) : corps. */
export interface DrawGiveawayRequest {
  pool: GiveawayPool;
}

/** `POST /admin/giveaway/draw` : issue du tirage. */
export type AdminGiveawayDrawResponse =
  | { kind: 'disabled' }
  | { kind: 'already-drawn'; drawId: string }
  | { kind: 'no-eligible'; drawId: string }
  | { kind: 'drawn'; drawId: string; winId: string; activation: GiveawayActivation };
