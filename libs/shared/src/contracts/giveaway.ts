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

// ── Lot B : page « Concours du mois », page gagnant, landing ─────────────────

/** Un gagnant tel qu'il peut être montré (nom selon l'accord, message seulement s'il est validé). */
export interface GiveawayPublicWinner {
  period: string;
  pool: GiveawayPool;
  /** « Un trader » sans accord d'affichage. */
  displayName: string;
  prizeMonths: number;
  /** Message validé par l'admin, sinon null. */
  message: string | null;
}

/** `GET /public/giveaway` (landing, sans compte) : seulement des données affichables. */
export interface GiveawayPublicState {
  /** Au moins un tirage allumé (sinon la landing n'affiche rien). */
  enabled: boolean;
  free: boolean;
  premium: boolean;
  freePrizeMonths: number;
  premiumPrizeMonths: number;
  minTrades: number;
  nextDrawAt: string;
  winnersFree: number;
  winnersPremium: number;
  /** Mois de Premium offerts en tout (lots attribués). */
  monthsOffered: number;
  /** Derniers gagnants (les plus récents d'abord). */
  winners: GiveawayPublicWinner[];
}

/**
 * Pourquoi l'utilisateur participe ou non au tirage qui le concerne :
 * `in` participe ; `need_trades` manque des trades ce mois-ci ; `premium_too_recent` abonné depuis
 * moins de 2 mois ; `account_too_recent` compte de moins de 7 jours ; `recent_winner` gagnant pendant la carence ; `cancel_scheduled` résiliation programmée ;
 * `pool_off` le tirage qui le concerne est éteint ; `not_eligible` (rôle, compte interne…).
 */
export type GiveawayMyReason =
  | 'in'
  | 'need_trades'
  | 'premium_too_recent'
  | 'account_too_recent'
  | 'recent_winner'
  | 'cancel_scheduled'
  | 'pool_off'
  | 'not_eligible';

/** Lot gagné par l'utilisateur, vu depuis sa page gagnant. */
export interface GiveawayMyWin {
  id: string;
  period: string;
  pool: GiveawayPool;
  prizeMonths: number;
  startsAt: string;
  endsAt: string;
  activationStatus: GiveawayActivation;
  displayConsent: GiveawayDisplayConsent;
  displayPseudo: string | null;
  message: string | null;
  moderation: GiveawayModeration;
  instagramConsent: boolean;
  instagramHandle: string | null;
}

/** `GET /giveaway/state` (app, connecté) : page « Concours du mois » et entrée de la barre latérale. */
export interface GiveawayAppState extends GiveawayPublicState {
  /** Compte démo : données d'exemple, affichées comme telles. */
  demo: boolean;
  me: {
    /** Tirage qui concerne l'utilisateur (abonné actif = PREMIUM, sinon FREE). */
    pool: GiveawayPool;
    reason: GiveawayMyReason;
    /** Trades du mois civil en cours (Paris) : progression vers `minTrades`. */
    tradesThisMonth: number;
  };
  /** Dernier lot gagné encore dans la carence (page gagnant), sinon null. */
  myWin: GiveawayMyWin | null;
}

/** `PATCH /giveaway/me/win` : affichage, message, accord Instagram. */
export interface UpdateMyGiveawayWinRequest {
  displayConsent: GiveawayDisplayConsent;
  displayPseudo?: string | null;
  message?: string | null;
  instagramConsent: boolean;
  instagramHandle?: string | null;
}
