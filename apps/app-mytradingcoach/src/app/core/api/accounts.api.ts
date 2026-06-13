import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type AccountType = 'EVALUATION' | 'FUNDED' | 'PERSONAL' | 'DEMO';
export type AccountStatus = 'ACTIVE' | 'PASSED' | 'FAILED' | 'ARCHIVED';
export type DrawdownType = 'STATIC' | 'TRAILING';

/** Métriques « règles prop firm » ESTIMÉES d'après les trades loggés (renvoyées par 089). */
export interface AccountRuleMetrics {
  startingBalance: number;
  realizedPnl: number;
  currentBalance: number;
  tradesCount: number;
  objective: { current: number; target: number; pct: number } | null;
  drawdown: {
    type: DrawdownType;
    floor: number;
    margin: number;
    maxDrawdown: number;
    pct: number;
    breached: boolean;
  } | null;
  estimated: true;
  disclaimer: string;
}

export interface TradingAccount {
  id: string;
  label: string;
  broker: string | null;
  type: AccountType;
  status: AccountStatus;
  accountSize: number | null;
  currency: string;
  startingBalance: number | null;
  profitTarget: number | null;
  maxDrawdown: number | null;
  drawdownType: DrawdownType;
  createdAt: string;
  updatedAt: string;
  metrics: AccountRuleMetrics;
}

export interface CreateAccountPayload {
  label: string;
  broker?: string | null;
  type?: AccountType;
  accountSize?: number | null;
  currency?: string;
  startingBalance?: number | null;
  profitTarget?: number | null;
  maxDrawdown?: number | null;
  drawdownType?: DrawdownType;
}

export type UpdateAccountPayload = Partial<CreateAccountPayload> & {
  status?: AccountStatus;
};

@Injectable({ providedIn: 'root' })
export class AccountsApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/accounts`;

  getAll(): Observable<{ data: TradingAccount[] }> {
    return this.http.get<{ data: TradingAccount[] }>(this.base);
  }

  create(payload: CreateAccountPayload): Observable<{ data: TradingAccount }> {
    return this.http.post<{ data: TradingAccount }>(this.base, payload);
  }

  update(id: string, payload: UpdateAccountPayload): Observable<{ data: TradingAccount }> {
    return this.http.patch<{ data: TradingAccount }>(`${this.base}/${id}`, payload);
  }

  remove(id: string): Observable<{ data: { deleted?: boolean; archived?: boolean } }> {
    return this.http.delete<{ data: { deleted?: boolean; archived?: boolean } }>(`${this.base}/${id}`);
  }
}
