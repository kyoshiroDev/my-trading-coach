import type { Plan, Role } from './enums';

/** Back-office : formes JSON des routes /admin (API + app admin). */

/** Fiche détaillée d'un utilisateur (GET /admin/users/:id). */
export interface AdminUserDetail {
  identity: {
    id: string;
    name: string | null;
    email: string;
    plan: Plan;
    role: Role;
    subscriptionStatus: string | null;
    /** Fin d'accès Premium hors plan (mois offert par l'admin, ou essai historique). */
    trialEndsAt: string | null;
    /** Premium offert par l'admin en cours : `trialEndsAt` futur ET aucun abonnement Stripe. */
    offeredPremium: boolean;
    isDemo: boolean;
    ambassadorRefCode: string | null;
    createdAt: string;
    lastActivityAt: string | null;
  };
  kpis: {
    daysSinceSignup: number;
    lastConnection: string | null;
    activeDays: number;
    totalDays: number;
    sessionTimeMinutes: number | null;
    ai: { usd: number; tokens: number };
  };
  activeDates: string[];
  aiByFeature: { feature: string; tokens: number; costUsd: number }[];
  // Profil trader (saisi à l'onboarding) : qui est ce trader.
  profile: {
    market: string | null;
    goal: string | null;
    tradingStyle: string | null;
    tradingStrategy: string[];
    tradingSessions: string[];
    tradesPerDayMin: number | null;
    tradesPerDayMax: number | null;
    strategyDescription: string | null;
    /** Capital déclaré au profil, sans devise : la devise est celle de chaque compte. */
    startingCapital: number;
  };
  // Usage réel (trades) : est-ce qu'il utilise vraiment l'app.
  usage: {
    totalTrades: number;
    tradesThisMonth: number;
    totalPnl: number;
    winRate: number;
  };
  topAssets: { asset: string; count: number }[];
  sessions: {
    date: string;
    trades: number;
    pnl: number;
    winRate: number;
    emotion: string | null;
    durationMinutes: number | null;
  }[];
}

/** État du serveur (GET /admin/vps/stats). */
export interface VpsStats {
  cpu: number;
  ram: { used: number; total: number };
  disk: { used: number; total: number };
  network: { up: number; down: number };
  uptime: number;
  os: string;
  kernel: string;
  node: string;
  docker: string;
  ip: string;
}

/** Acquisition par source (GET /admin/acquisition). */
export interface AdminAcquisitionRow {
  /**
   * `utm_source` normalisé, sinon hôte du site d'origine (ex. `ninjatrader.com`) ;
   * null = direct / non renseigné.
   */
  source: string | null;
  /** Visites de la landing (1re page vue d'une session), sans cookie. */
  visits7d: number;
  visits30d: number;
  signups7d: number;
  signups30d: number;
  signupsTotal: number;
  /** Abonnement Stripe en cours (active, trialing ou past_due). */
  premium: number;
  /** Dont en essai (trialing) : carte enregistrée, pas encore facturé. */
  trialing: number;
  /** signups30d / visits30d, en % (1 décimale) ; 0 sans visite. */
  visitToSignupRate: number;
  /** premium / signupsTotal, en % (1 décimale). */
  conversionRate: number;
}

/** Un jour de trafic landing (Europe/Paris), jours sans visite inclus à 0. */
export interface AdminLandingDay {
  date: string;
  visits: number;
  pageviews: number;
}

export interface AdminLandingPage {
  path: string;
  visits: number;
  pageviews: number;
}

/** Détail par source + medium + campagne (null = non renseigné). */
export interface AdminAcquisitionCampaignRow extends AdminAcquisitionRow {
  /** `utm_medium` (ex. `bio`, `story`, `post`, `listing`) ou `referral` (plan B site d'origine). */
  medium: string | null;
  campaign: string | null;
}

export interface AdminAcquisitionData {
  rows: AdminAcquisitionRow[];
  /** Même données détaillées par source + medium + campagne, 50 lignes max. */
  campaigns: AdminAcquisitionCampaignRow[];
  totals: Omit<AdminAcquisitionRow, 'source'> & { pageviews30d: number };
  /** 30 derniers jours, du plus ancien au plus récent. */
  daily: AdminLandingDay[];
  /** Pages les plus vues sur 30 jours (10 max). */
  topPages: AdminLandingPage[];
}
