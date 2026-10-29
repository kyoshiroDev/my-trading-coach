import type { AuthProvider, Plan, Role, TrialSource } from './enums';
import type { SignupFunnelStep } from '../signup-funnel';
import type { LandingEngagementPage } from '../landing-engagement';
import type { AcquisitionUtm } from '../acquisition-filter';

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
    /** Origine de `trialEndsAt` (#769) : SIGNUP = essai d'inscription, ADMIN = Premium offert ; null = aucune. */
    trialSource: TrialSource | null;
    /** Accès Premium réel (plan, rôle ADMIN / BETA_TESTER ou essai en cours), même règle que les guards. */
    premiumAccess: boolean;
    isDemo: boolean;
    ambassadorRefCode: string | null;
    /** UTM enregistrés à l'inscription (#625) ; null = non renseigné. */
    acquisition: AcquisitionUtm;
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
  /** Offre fondateur / code partenaire (#525). `null` si aucun. */
  offer: {
    founder: {
      number: number;
      /** ACTIVE · LOST (tarif perdu) · REFUNDED (remboursé) · RELEASED (1er paiement en échec). */
      status: 'ACTIVE' | 'LOST' | 'REFUNDED' | 'RELEASED';
      interval: 'month' | 'year';
      takenAt: string;
      /** Date de perte du tarif (fin d'abonnement ou remboursement). */
      endedAt: string | null;
      cta: string | null;
      /** Réservée pendant l'essai d'inscription, pas encore payée (#769) : abonnement Stripe en essai. */
      reserved: boolean;
      /** Date du premier prélèvement d'une place réservée (fin de l'essai Stripe), sinon null. */
      firstChargeAt: string | null;
    } | null;
    partner: {
      code: string;
      priceMonthlyEur: number;
      priceAnnualEur: number;
      durationMonths: number | null;
      status: 'ACTIVE' | 'LOST' | 'RELEASED';
      since: string;
      endedAt: string | null;
    } | null;
  };
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

/** Inscriptions d'une méthode (#618), hors démo et ADMIN. */
export interface AdminSignupMethodRow {
  method: AuthProvider;
  signups7d: number;
  signups30d: number;
  signupsTotal: number;
  /** Part des inscriptions des 30 derniers jours, en % (1 décimale). */
  share30d: number;
}

/** GET /admin/signup-methods — répartition e-mail / Google et finalisation des inscriptions Google. */
export interface AdminSignupMethodsData {
  /** Toujours les deux méthodes, e-mail d'abord. */
  rows: AdminSignupMethodRow[];
  google: {
    /** Inscriptions Google dont l'écran de finalisation (opt-in marketing) a été validé. */
    finalized: number;
    /** finalized / inscriptions Google, en % (1 décimale) ; 0 sans inscription Google. */
    finalizationRate: number;
    /** Comptes créés par e-mail puis reliés à Google. */
    linkedEmailAccounts: number;
  };
}

/** Une étape de l'entonnoir Premium : utilisateurs DISTINCTS (hors démo et admin) sur la période. */
export interface AdminFunnelStep {
  key: 'premium_seen' | 'plan_modal_open' | 'trial_click' | 'checkout_success' | 'checkout_canceled';
  users: number;
}

/** Détail par écran : où les inscrits rencontrent le Premium, ouvrent les offres, cliquent. */
export interface AdminFunnelPlace {
  event: 'premium_seen' | 'plan_modal_open' | 'trial_click';
  place: string;
  users: number;
}

/** Événements de l'installation de l'app (même liste que `INSTALL_EVENTS` côté API). */
export type AdminInstallEvent =
  | 'install_shown'
  | 'install_click'
  | 'install_done'
  | 'install_later'
  | 'install_never'
  | 'inapp_seen'
  | 'push_enabled'
  | 'push_denied';

/**
 * Installation de l'app : users DISTINCTS par événement et par plateforme (`android`, `ios`,
 * `ios-other` = iPhone hors Safari, `desktop`), hors démo et admin. Plateforme brute, jamais regroupée.
 */
export interface AdminInstallRow {
  event: AdminInstallEvent;
  place: string;
  users: number;
}

/** GET /admin/funnel — de la visite au paiement, sur `days` jours (Paris). */
export interface AdminFunnelData {
  days: number;
  landingVisits: number;
  signups: number;
  demo: { opens: number; signupClicks: number };
  steps: AdminFunnelStep[];
  byPlace: AdminFunnelPlace[];
  install: AdminInstallRow[];
  /** État Stripe actuel (hors démo et admin) : essais en cours, abonnés payants. */
  current: { trialing: number; paying: number };
  /**
   * Essai Premium de l'inscription (#769, B3), hors démo et admin. `inProgress` : fin à venir, sans
   * abonnement payant. `ended` : fin dans la période. `converted` : parmi `ended`, abonnement payant
   * (`active`) aujourd'hui. `reservations` : places fondateur réservées jamais payées, dont
   * `reservationsAwaitingPayment` en `past_due` / `unpaid` (3D Secure non confirmé, carte refusée) ;
   * `nextChargeAt` : prochain premier prélèvement d'une réservation encore en essai.
   */
  signupTrial: {
    inProgress: number;
    ended: number;
    converted: number;
    reservations: number;
    reservationsAwaitingPayment: number;
    nextChargeAt: string | null;
  };
}

/**
 * Une ligne du parcours d'inscription : source + medium + campagne (null = non renseigné) et
 * navigateur intégré ou non. Compteurs d'événements anonymes (pas des utilisateurs distincts).
 */
export interface AdminSignupFunnelRow {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  inApp: boolean;
  /** Visites landing (1re page d'une session d'onglet). */
  visits: number;
  steps: Record<SignupFunnelStep, number>;
}

/** Erreurs d'inscription par source et code normalisé. */
export interface AdminSignupFunnelError {
  source: string | null;
  inApp: boolean;
  code: string;
  count: number;
}

/** GET /admin/signup-funnel?days=7|30 — de la visite au paiement, par source (jours Paris). */
export interface AdminSignupFunnelData {
  days: 7 | 30;
  /** Triées par visites puis clics CTA décroissants, 100 lignes max. */
  rows: AdminSignupFunnelRow[];
  /** Triées par nombre décroissant, 50 max. */
  errors: AdminSignupFunnelError[];
}

/**
 * Engagement d'une page de la landing pour une source / medium / campagne (tous navigateurs).
 * Compteurs d'événements anonymes : un seuil compte au plus une fois par chargement de page.
 */
export interface AdminLandingEngagementRow {
  path: LandingEngagementPage;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  /** Pages vues (`LandingVisitDaily.pageviews`) : la base des taux. */
  views: number;
  /** Chargements ayant atteint chaque seuil de `LANDING_SCROLL_THRESHOLDS`, dans le même ordre. */
  scroll: number[];
  /** Chargements restés visibles chaque seuil de `LANDING_TIME_THRESHOLDS`, dans le même ordre. */
  time: number[];
  /** Chargements où le sélecteur de règles a servi. */
  rulesUse: number;
}

/** GET /admin/landing-engagement?days=7|30 — défilement, temps passé et sélecteur, par page et campagne. */
export interface AdminLandingEngagementData {
  days: 7 | 30;
  /** Triées par page (ordre de `LANDING_ENGAGEMENT_PAGES`) puis vues décroissantes, 100 lignes max. */
  rows: AdminLandingEngagementRow[];
}

// ── Liaison des comptes aux plans prop firm (GET /admin/prop-firms/plan-links, #612) ──────────

/** Comptes connectés à un broker (sous-compte choisi, non archivés), hors démo et hors ADMIN. */
export interface AdminPlanLinkStats {
  connected: number;
  /** Reliés à un plan du catalogue. */
  linked: number;
  /** `linked / connected`, en % arrondi ; null sans compte connecté. */
  rate: number | null;
  /** Comptes connectés SANS plan, par réponse à « Quel est ce compte ? » (`none` = jamais répondu). */
  unlinked: { later: number; personal: number; unlisted: number; none: number };
  /** Réponses « Ma firm n'est pas dans la liste » (tous comptes réels), regroupées par nom. */
  unlistedFirms: { name: string; count: number; lastAt: string }[];
}
