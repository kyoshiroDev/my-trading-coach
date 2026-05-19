import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export interface AdminUser {
  id: string; email: string; name: string | null;
  plan: 'FREE' | 'PREMIUM'; role: 'ADMIN' | 'USER' | 'BETA_TESTER';
  trialEndsAt: string | null; stripeInterval: 'month' | 'year' | null;
  stripeCurrentPeriodEnd: string | null;
  lastSeenAt: string | null; lastLoginAt: string | null; createdAt: string;
}

export interface AdminStats {
  mrr: number; arr: number; totalPremium: number;
  monthly: number; annual: number; trials: number;
  freeUsers: number; newThisMonth: number; churnedThisMonth: number;
  betaTesters: number;
}

export interface AdminOnlineUser {
  id: string; email: string; name: string | null;
  plan: 'FREE' | 'PREMIUM'; role: 'ADMIN' | 'USER' | 'BETA_TESTER';
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

export interface AiUsageData {
  today: { inputTokens: number; outputTokens: number; costUsd: number; calls: number };
  week:  { inputTokens: number; outputTokens: number; costUsd: number; calls: number };
  byFeature: { feature: string; tokens: number; cost: number; pct: number }[];
  topUsers:  { userId: string; email: string; name: string; tokens: number; cost: number }[];
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
  lastSent?: string | null;
  lastCount?: number;
  targetCount: number;
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
  update(id: string, dto: { name?: string; plan?: 'FREE' | 'PREMIUM'; role?: 'USER' | 'BETA_TESTER' }) {
    return this.http.patch<{ data: AdminUser }>(`${this.base}/${id}`, dto);
  }
  delete(id: string)    { return this.http.delete<void>(`${this.base}/${id}`); }
  stats()               { return this.http.get<{ data: AdminStats }>(`${this.base}/stats`); }
  online()              { return this.http.get<{ data: AdminOnlineUser[] }>(`${this.base}/online`); }
  subscriptions()       { return this.http.get<{ data: SubscriptionsData }>(`${this.base}/subscriptions`); }
  aiUsage()             { return this.http.get<{ data: AiUsageData }>(`${environment.apiUrl}/admin/ai-usage`); }

  listCampaigns() {
    return this.http.get<{ data: CampaignMeta[] }>(`${this.adminBase}/campaigns`);
  }
  previewCampaign(type: string, subject?: string, content?: string) {
    return this.http.post<{ data: { html: string; recipients: { email: string; name: string | null }[] } }>(
      `${this.adminBase}/campaigns/${type}/preview`, { subject, content },
    );
  }
  sendCampaign(type: string, subject?: string, content?: string) {
    return this.http.post<{ data: { success: number; errors: number } }>(
      `${this.adminBase}/campaigns/${type}/send`, { subject, content },
    );
  }
}
