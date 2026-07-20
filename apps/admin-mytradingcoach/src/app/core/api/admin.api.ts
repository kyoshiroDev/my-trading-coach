import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export interface AdminUser {
  id: string; email: string; name: string | null;
  plan: 'FREE' | 'PREMIUM'; role: 'ADMIN' | 'USER' | 'BETA_TESTER' | 'AMBASSADOR';
  trialEndsAt: string | null; stripeInterval: 'month' | 'year' | null;
  stripeCurrentPeriodEnd: string | null;
  lastSeenAt: string | null; lastLoginAt: string | null; createdAt: string;
}

export interface AdminStats {
  mrr: number; arr: number;
  totalUsers: number;
  totalPremium: number;
  premiumMonthly: number; premiumAnnual: number;
  monthly: number; annual: number;
  trials: number;
  freeUsers: number; newThisMonth: number; churnedThisMonth: number;
  betaTesters: number; ambassadors: number;
  // Engagement par récence (≥1 trade sur la fenêtre) — distinct de l'activation.
  tradersActifs7d: number; tradersActifs30d: number;
  // Comptes supprimés (trace RGPD) — distinct du churn d'abonnement.
  comptesSupprimesMois: number; comptesSupprimesTotal: number;
}

export interface AdminOnlineUser {
  id: string; email: string; name: string | null;
  plan: 'FREE' | 'PREMIUM'; role: 'ADMIN' | 'USER' | 'BETA_TESTER' | 'AMBASSADOR';
  lastSeenAt: string; lastLoginAt: string | null;
}

export interface AdminUserProfile {
  tradingStyle?: string | null;
  tradingStrategy?: string[];
  tradingSessions?: string[];
  tradesPerDayMin?: number | null;
  tradesPerDayMax?: number | null;
  strategyDescription?: string | null;
  market?: string | null;
  goal?: string | null;
  currency?: string;
  startingCapital?: number;
}

export interface AdminUserDetailStats {
  totalTrades: number;
  tradesThisMonth: number;
  totalPnl: number;
  winRate: number;
  totalAiCalls: number;
  totalTokens: number;
  totalCostUsd: number;
  byFeature: Record<string, number>;
  monthlyLimit: number | null;
  monthlyPercent: number | null;
}

export interface AdminTopAsset { asset: string; count: number; }

export interface AdminUserDetail {
  user: AdminUser & AdminUserProfile;
  stats: AdminUserDetailStats;
  topAssets: AdminTopAsset[];
  timeline: { action: string; detail: string; type: 'auth' | 'ai' | 'trade'; createdAt: string }[];
}

/** Usage IA 30j : coût RÉEL (Cost API) + attribution ESTIMÉE (logs) + réconciliation. */
export interface AiCostData {
  billed: {
    total30d: number;
    byModel: { model: string; costUsd: number; pct: number }[];
    daily:   { date: string; costUsd: number }[];
    updatedAt: string | null;
  };
  attributed: {
    total30d: number;
    byFeature: { feature: string; cost: number; pct: number }[];
    topUsers:  { userId: string; name: string; email: string; calls: number; tokens: number; cost: number }[];
  };
  unattributed: number;
}

export interface SubscriptionsData {
  stripeUsers: AdminUser[];
  betaTesters: AdminUser[];
  total: number; page: number; limit: number;
}

export interface CampaignMeta {
  type: string;
  label: string;
  emoji: string;
  desc: string;
  targetDesc: string;
  kind: 'transactional' | 'marketing';
  automated: boolean;
  requiresConsent: boolean;
  lastSent?: string | null;
  lastCount?: number;
  targetCount: number; // users dans le segment (matching)
  alreadyContacted: number; // ont déjà reçu cette campagne
  newCount: number; // nouveaux destinataires (matching - alreadyContacted)
}

export interface AdminAmbassador {
  id: string;
  name: string | null;
  email: string;
  referralCode: string;
  totalReferrals: number;
  premiumReferrals: number;
  totalEarned: number;
  pendingPayout: number;
}

export interface AdminAmbassadorPromoteResult {
  email: string;
  name: string | null;
  role: 'ADMIN' | 'USER' | 'BETA_TESTER' | 'AMBASSADOR';
  referralCode: string;
  referralLink: string;
}

export interface AdminAmbassadorDetail {
  referralCode: string;
  referrals: Array<{
    id: string;
    name: string | null;
    email: string;
    plan: 'FREE' | 'PREMIUM';
    createdAt: string;
    isActive: boolean;
  }>;
  total: number;
  free: number;
  premium: number;
  earningsByMonth: Record<string, number>;
  totalEarned: number;
  pendingPayout: number;
}

export interface RetentionData {
  activation: { rate: number; activated: number; total: number };
  activationThisMonth: { rate: number; activated: number; total: number };
  active: { dau: number; wau: number; mau: number };
  retentionD7: { rate: number; retained: number; eligible: number };
  ghostUsers: number;
}

export interface MetricsHistoryPoint {
  date: string; // YYYY-MM-DD (Paris)
  users: number;
  mrr: number;
  newSignups: number; // inscriptions du jour → agrégées par semaine pour les barres
}

export interface DeletedAccount {
  id: string;
  name: string | null;
  email: string | null;
  signedUpAt: string;
  deletedAt: string;
  lifetimeDays: number;
  plan: 'FREE' | 'PREMIUM';
  hadTraded: boolean;
  tradesCount: number;
  referredBy: string | null;
  deletedBy: string; // "self" | "admin"
  reason: string | null;
  anonymizedAt: string | null;
}

export interface ReferralAdminParrain {
  referralCode: string;
  name: string | null;
  email: string;
  invited: number;
  payants: number;
  conversion: number;
  moisGagnes: number;
  moisAppliques: number;
}

export interface ReferralAdminFilleul {
  pseudo: string;
  parrainCode: string | null;
  status: 'payant' | 'essai' | 'inscrit';
  date: string;
}

export interface ReferralAdminOverview {
  parrainsActifs: number;
  invitesTotal: number;
  payants: number;
  tauxConversion: number;
  moisAccordes: number;
  moisAAppliquer: number;
  parrains: ReferralAdminParrain[];
  filleulsRecents: ReferralAdminFilleul[];
}

export interface UserDetailData {
  identity: {
    id: string;
    name: string | null;
    email: string;
    plan: 'FREE' | 'PREMIUM';
    role: 'ADMIN' | 'USER' | 'BETA_TESTER' | 'AMBASSADOR';
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
  profile: {
    market: string | null;
    goal: string | null;
    tradingStyle: string | null;
    tradingStrategy: string[];
    tradingSessions: string[];
    tradesPerDayMin: number | null;
    tradesPerDayMax: number | null;
    strategyDescription: string | null;
    startingCapital: number;
    currency: string;
  };
  usage: {
    totalTrades: number;
    tradesThisMonth: number;
    totalPnl: number;
    winRate: number;
  };
  topAssets: { asset: string; count: number }[];
  sessions: { date: string; trades: number; pnl: number; winRate: number; emotion: string | null; durationMinutes: number | null }[];
}

export interface DeletedAccountsData {
  accounts: DeletedAccount[];
  stats: { thisMonth: number; total: number; medianLifetimeDays: number; noTradePct: number; noTradeCount: number };
  byMonth: { month: string; count: number }[];
  byReason: { reason: string; count: number }[];
}

export interface StripeReconcileData {
  mrrDb: number;
  mrrStripe: number;
  gap: number;
  dbActiveCount: number;
  stripeActiveCount: number;
  divergences: {
    inDbNotStripe: { userId: string; email: string; name: string | null; plan: string; subscriptionId: string | null; status: string | null }[];
    inStripeNotDb: { subscriptionId: string; customerId: string | null; status: string; monthly: number }[];
  };
}

@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/users/admin`;
  private readonly adminBase = `${environment.apiUrl}/admin`;

  list(page = 1, limit = 20, search?: string) {
    let params = new HttpParams().set('page', page).set('limit', limit);
    if (search) params = params.set('search', search);
    return this.http.get<{ data: { users: AdminUser[]; total: number } }>(this.base, { params });
  }
  detail(id: string)    { return this.http.get<{ data: AdminUserDetail }>(`${this.base}/${id}/detail`); }
  update(id: string, dto: { name?: string; plan?: 'FREE' | 'PREMIUM'; role?: 'USER' | 'BETA_TESTER' | 'AMBASSADOR' }) {
    return this.http.patch<{ data: AdminUser }>(`${this.base}/${id}`, dto);
  }
  delete(id: string)    { return this.http.delete<void>(`${this.base}/${id}`); }
  stats()               { return this.http.get<{ data: AdminStats }>(`${this.base}/stats`); }
  online()              { return this.http.get<{ data: AdminOnlineUser[] }>(`${this.base}/online`); }
  subscriptions()       { return this.http.get<{ data: SubscriptionsData }>(`${this.base}/subscriptions`); }
  aiCost()              { return this.http.get<{ data: AiCostData }>(`${environment.apiUrl}/admin/ai-cost`); }
  refreshAiCost()       { return this.http.post<{ data: { ok: boolean; rows: number; total30d: number } }>(`${environment.apiUrl}/admin/ai-cost/refresh`, {}); }
  retention()           { return this.http.get<{ data: RetentionData }>(`${this.adminBase}/retention`); }
  metricsHistory(days = 30) {
    return this.http.get<{ data: MetricsHistoryPoint[] }>(
      `${this.adminBase}/metrics/history`, { params: { days } },
    );
  }
  deletedAccounts() {
    return this.http.get<{ data: DeletedAccountsData }>(`${this.adminBase}/deleted-accounts`);
  }
  stripeReconcile()     { return this.http.get<{ data: StripeReconcileData }>(`${this.adminBase}/stripe/reconcile`); }
  referralOverview()    { return this.http.get<{ data: ReferralAdminOverview }>(`${environment.apiUrl}/referral/admin/overview`); }

  listCampaigns() {
    return this.http.get<{ data: CampaignMeta[] }>(`${this.adminBase}/campaigns`);
  }
  previewCampaign(type: string, subject?: string, content?: string) {
    return this.http.post<{ data: { html: string; recipients: { email: string; name: string | null }[] } }>(
      `${this.adminBase}/campaigns/${type}/preview`, { subject, content },
    );
  }
  sendCampaign(type: string, subject?: string, content?: string, force = false) {
    return this.http.post<{ data: { success: number; errors: number; skipped?: number } }>(
      `${this.adminBase}/campaigns/${type}/send`, { subject, content, force },
    );
  }

  getAmbassadors() {
    return this.http.get<{ data: AdminAmbassador[] }>(
      `${environment.apiUrl}/ambassador/list`,
    );
  }

  getAmbassadorDetail(userId: string) {
    return this.http.get<{ data: AdminAmbassadorDetail }>(
      `${environment.apiUrl}/ambassador/stats`,
      { params: { userId } },
    );
  }

  markAmbassadorPaid(ambassadorId: string) {
    return this.http.patch<{ data: { success: boolean } }>(
      `${environment.apiUrl}/ambassador/pay-all/${ambassadorId}`,
      {},
    );
  }

  promoteAmbassador(email: string, referralCode?: string) {
    return this.http.post<{ data: AdminAmbassadorPromoteResult }>(
      `${environment.apiUrl}/ambassador/admin/promote`,
      referralCode ? { email, referralCode } : { email },
    );
  }

  revokeAmbassador(email: string) {
    return this.http.post<{ data: { email: string; name: string | null; role: string } }>(
      `${environment.apiUrl}/ambassador/admin/revoke`,
      { email },
    );
  }
}
