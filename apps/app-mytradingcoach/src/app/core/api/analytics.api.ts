import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@app/environments/environment';

export interface AnalyticsSummary {
  winRate: number;
  totalPnl: number;
  totalTrades: number;
  maxDrawdown: number;
  profitFactor: number | null;
  streak: number;
  topSession: string;
  topSessionWinRate: number;
  topHour: string;
}

export interface SetupStat {
  setupId: string;
  title: string;
  color: string;
  winRate: number | null;
  /** null = aucun trade du setup n'a de R:R (pas de stop ni d'objectif) → « – ». */
  avgRR: number | null;
  count: number;
  pnl: number;
}

export interface EmotionStat {
  emotion: string;
  winRate: number;
  avgRR: number;
  count: number;
}

export interface HeatmapCell {
  day: string;
  hour: number;
  winRate: number;
  count: number;
}

export interface EquityPoint {
  date: string;
  cumulativePnl: number;
  /** Payout reçu ce jour-là (ajouté par `withPayouts`, jamais renvoyé par l'API dans les points). */
  payout?: number;
}

/** Payout reçu (retrait détecté chez le broker, non écarté). */
export interface EquityPayout {
  date: string;
  amount: number;
}

/**
 * Historique avant la période d'une courbe (`/equity-curve/daily` avec `from`) : P&L net cumulé et
 * son plus haut en clôture de journée (≥ 0). Sans `from` : 0 / 0.
 */
export interface PeriodBefore {
  pnl: number;
  peak: number;
  /** Trades avant la période ; 0 → la période couvre le début du compte. */
  count?: number;
  /** Total des payouts reçus avant la période. */
  payouts?: number;
}

/** Réponse de `/equity-curve/daily`. `startingCapital` = capital du PROFIL, pas celui du compte :
 *  ne pas s'en servir pour placer la courbe (cf. `periodStartCapital`). */
export interface DailyEquityCurve {
  points: EquityPoint[];
  startingCapital: number | null;
  before?: PeriodBefore;
  /** Payouts reçus pendant la période (le solde du compte les a déjà perdus). */
  payouts?: EquityPayout[];
}

export interface EquityCurveResponse {
  points: EquityPoint[];
  startingCapital: number | null;
}

export interface TopAsset {
  asset: string;
  winRate: number;
  pnl: number;
  count: number;
}

export interface DailyActivity {
  date: string;
  pnl: number;
  tradesCount: number;
  winRate: number;
}

export interface MonthlyActivitySummary {
  year: number;
  month: number;
  days: DailyActivity[];
  totalPnl: number;
  totalTrades: number;
  tradingDays: number;
}

@Injectable({ providedIn: 'root' })
export class AnalyticsApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/analytics`;

  getSummary(): Observable<{ data: AnalyticsSummary }> {
    return this.http.get<{ data: AnalyticsSummary }>(`${this.base}/summary`);
  }

  getBySetup(): Observable<{ data: SetupStat[] }> {
    return this.http.get<{ data: SetupStat[] }>(`${this.base}/by-setup`);
  }

  getByEmotion(): Observable<{ data: EmotionStat[] }> {
    return this.http.get<{ data: EmotionStat[] }>(`${this.base}/by-emotion`);
  }

  getByHour(): Observable<{ data: HeatmapCell[] }> {
    return this.http.get<{ data: HeatmapCell[] }>(`${this.base}/by-hour`);
  }

  getEquityCurve(): Observable<{ data: EquityCurveResponse }> {
    return this.http.get<{ data: EquityCurveResponse }>(
      `${this.base}/equity-curve`,
    );
  }

  /** Courbe d'équité jour par jour, bornée (`from`/`to`) et scopée compte (`accountId`). */
  getDailyEquityCurve(query: { from?: string | null; to?: string | null; accountId?: string | null; includeInactive?: boolean }): Observable<{
    data: DailyEquityCurve;
  }> {
    const params: Record<string, string> = {};
    if (query.from) params['from'] = query.from;
    if (query.to) params['to'] = query.to;
    if (query.accountId) params['accountId'] = query.accountId;
    // « Tous les comptes » avec les comptes échoués et archivés (interrupteur des statistiques).
    else if (query.includeInactive) params['includeInactive'] = 'true';
    return this.http.get<{ data: DailyEquityCurve }>(
      `${this.base}/equity-curve/daily`,
      { params },
    );
  }

  getTopAssets(): Observable<{ data: TopAsset[] }> {
    return this.http.get<{ data: TopAsset[] }>(`${this.base}/top-assets`);
  }

  getCurrentMonthActivity(accountId?: string): Observable<{ data: MonthlyActivitySummary }> {
    const q = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
    return this.http.get<{ data: MonthlyActivitySummary }>(`${this.base}/activity/current-month${q}`);
  }

  getMonthActivity(year: number, month: number, accountId?: string, includeInactive = false): Observable<{ data: MonthlyActivitySummary }> {
    const q = accountId
      ? `?accountId=${encodeURIComponent(accountId)}`
      : includeInactive ? '?includeInactive=true' : '';
    return this.http.get<{ data: MonthlyActivitySummary }>(`${this.base}/activity/${year}/${month}${q}`);
  }
}
