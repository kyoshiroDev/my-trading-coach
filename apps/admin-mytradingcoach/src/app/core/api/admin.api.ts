import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '@admin/environments/environment';
import type { AdminUserDetail as UserDetailData, Plan, Role } from '@mtc/shared';
export type { UserDetailData };

export interface AdminUser {
  id: string; email: string; name: string | null;
  plan: Plan; role: Role;
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
  // Engagement par récence (≥1 trade sur la fenêtre) : distinct de l'activation.
  tradersActifs7d: number; tradersActifs30d: number;
  // Comptes supprimés (trace RGPD) : distinct du churn d'abonnement.
  comptesSupprimesMois: number; comptesSupprimesTotal: number;
}

export interface AdminOnlineUser {
  id: string; email: string; name: string | null;
  plan: Plan; role: Role;
  lastSeenAt: string; lastLoginAt: string | null;
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
  role: Role;
  referralCode: string;
  referralLink: string;
}

export interface AdminAmbassadorDetail {
  referralCode: string;
  referrals: Array<{
    id: string;
    name: string | null;
    email: string;
    plan: Plan;
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
  plan: Plan;
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
  /** Toutes les routes admin de l'API vivent sous /admin (guard admin au niveau du contrôleur). */
  private readonly adminBase = `${environment.apiUrl}/admin`;
  private readonly usersBase = `${this.adminBase}/users`;

  list(page = 1, limit = 20, search?: string) {
    let params = new HttpParams().set('page', page).set('limit', limit);
    if (search) params = params.set('search', search);
    return this.http.get<{ data: { users: AdminUser[]; total: number } }>(this.usersBase, { params });
  }
  update(id: string, dto: { name?: string; plan?: Plan; role?: 'USER' | 'BETA_TESTER' | 'AMBASSADOR' }) {
    return this.http.patch<{ data: AdminUser }>(`${this.usersBase}/${id}`, dto);
  }
  delete(id: string)    { return this.http.delete<void>(`${this.usersBase}/${id}`); }
  stats()               { return this.http.get<{ data: AdminStats }>(`${this.usersBase}/stats`); }
  online()              { return this.http.get<{ data: AdminOnlineUser[] }>(`${this.usersBase}/online`); }
  subscriptions()       { return this.http.get<{ data: SubscriptionsData }>(`${this.usersBase}/subscriptions`); }
  aiCost()              { return this.http.get<{ data: AiCostData }>(`${this.adminBase}/ai-cost`); }
  refreshAiCost()       { return this.http.post<{ data: { ok: boolean; rows: number; total30d: number } }>(`${this.adminBase}/ai-cost/refresh`, {}); }
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
  referralOverview()    { return this.http.get<{ data: ReferralAdminOverview }>(`${this.adminBase}/referral/overview`); }

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
    return this.http.get<{ data: AdminAmbassador[] }>(`${this.adminBase}/ambassadors`);
  }

  getAmbassadorDetail(userId: string) {
    return this.http.get<{ data: AdminAmbassadorDetail }>(`${this.adminBase}/ambassadors/${userId}/stats`);
  }

  markAmbassadorPaid(ambassadorId: string) {
    return this.http.patch<{ data: { success: boolean } }>(`${this.adminBase}/ambassadors/${ambassadorId}/pay-all`, {});
  }

  promoteAmbassador(email: string, referralCode?: string) {
    return this.http.post<{ data: AdminAmbassadorPromoteResult }>(
      `${this.adminBase}/ambassadors/promote`,
      referralCode ? { email, referralCode } : { email },
    );
  }

  // ── Registre des brokers ──────────────────────────────────────────────────
  // `analyse` est le SEUL appel qui coûte de l'IA (~0,003 $). `preview` rejoue une fiche
  // corrigée à la main, gratuitement : l'admin peut ajuster autant qu'il veut.

  brokerMappings() {
    return this.http.get<{ data: BrokerMappingRow[] }>(`${this.adminBase}/broker-mappings`);
  }

  analyseBrokerSample(sample: string) {
    return this.http.post<{ data: BrokerMappingAnalysis }>(
      `${this.adminBase}/broker-mappings/analyse`,
      { sample },
    );
  }

  previewBrokerMapping(sample: string, mapping: BrokerMapping) {
    return this.http.post<{ data: BrokerMappingAnalysis }>(
      `${this.adminBase}/broker-mappings/preview`,
      { sample, mapping },
    );
  }

  saveBrokerMapping(sample: string, mapping: BrokerMapping, brokerName: string) {
    return this.http.post<{ data: { id: string } }>(
      `${this.adminBase}/broker-mappings`,
      { sample, mapping, brokerName },
    );
  }

  setBrokerMappingEnabled(id: string, enabled: boolean) {
    return this.http.patch<{ data: { id: string; enabled: boolean } }>(
      `${this.adminBase}/broker-mappings/${id}/enabled`,
      { enabled },
    );
  }

  revokeAmbassador(email: string) {
    return this.http.post<{ data: { email: string; name: string | null; role: string } }>(
      `${this.adminBase}/ambassadors/revoke`,
      { email },
    );
  }
}

/**
 * Registre des brokers : fiche de correspondance des colonnes d'un export CSV.
 * Le modèle la déduit d'un échantillon, un admin la corrige et la valide, puis elle sert
 * à tous les utilisateurs — donc les index doivent être lisibles et modifiables à la main.
 */
export interface BrokerMappingColumns {
  symbol: number;
  entry: number | null;
  exit: number;
  quantity: number;
  pnl: number;
  tradedAt: number;
}

export interface BrokerMappingSide {
  mode: 'column' | 'derived_from_timestamps';
  index: number | null;
  longValues: string[];
  shortValues: string[];
  buyTimeIndex: number | null;
  sellTimeIndex: number | null;
}

export interface BrokerMapping {
  delimiter: string;
  decimalSeparator: '.' | ',';
  /** Ordre jour/mois des dates : « 01/06 » vaut le 1er juin en dmy, le 6 janvier en mdy. */
  dateFormat: 'iso' | 'dmy' | 'mdy';
  columns: BrokerMappingColumns;
  side: BrokerMappingSide;
  pnlExtraColumns: number[];
  notes?: string;
}

/** Trade tel qu'il serait importé : c'est l'aperçu que l'admin valide, pas le JSON. */
export interface BrokerMappingPreviewRow {
  asset?: string;
  side?: string;
  entry?: number;
  exit?: number;
  quantity?: number;
  pnl?: number;
  tradedAt?: string;
}

export interface BrokerMappingAnalysis {
  header: string;
  mapping: BrokerMapping | null;
  preview: BrokerMappingPreviewRow[];
  /** Part des lignes testables dont le signe du P&L confirme le sens. null = non vérifiable. */
  pnlRatio: number | null;
  /** Le sens proposé a été redressé par le contrôle arithmétique. */
  flipped: boolean;
  skipped: number;
  rowsRead: number;
  /**
   * Colonnes additionnées au P&L. Non vérifiable par le code : il faudrait la valeur du point
   * de l'instrument. C'est à l'admin de dire si c'est un complément légitime (MT5 éclate le
   * résultat) ou un double comptage (une colonne « net » inclut déjà les frais).
   */
  fraisAdditionnes: number[];
}

export interface BrokerMappingRow {
  id: string;
  brokerName: string;
  headerSample: string;
  pnlConfidence: number;
  enabled: boolean;
  usageCount: number;
  createdAt: string;
}
