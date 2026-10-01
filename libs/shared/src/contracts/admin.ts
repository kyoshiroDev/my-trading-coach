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

/** Acquisition par source UTM (GET /admin/acquisition). */
export interface AdminAcquisitionRow {
  /** `utm_source` normalisé ; null = direct / non renseigné. */
  source: string | null;
  signups7d: number;
  signups30d: number;
  signupsTotal: number;
  /** Abonnement Stripe en cours (active, trialing ou past_due). */
  premium: number;
  /** Dont en essai (trialing) : carte enregistrée, pas encore facturé. */
  trialing: number;
  /** premium / signupsTotal, en % (1 décimale). */
  conversionRate: number;
}

export interface AdminAcquisitionData {
  rows: AdminAcquisitionRow[];
  totals: Omit<AdminAcquisitionRow, 'source'>;
}
