import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@app/environments/environment';
import type { AccountStatus, AccountType, DrawdownType } from '@mtc/shared';

export type { AccountStatus, AccountType, DrawdownType };

/** Règle officielle appliquée au drawdown (compte relié à un plan du catalogue). */
export interface DrawdownPlanRule {
  firmName: string;
  planName: string;
  phase: 'evaluation' | 'funded' | 'direct';
  kind: 'static' | 'trailing_eod' | 'trailing_intraday';
  locksAt: number | null;
  lockedFloor: number | null;
  locked: boolean;
  realtimeEquity: boolean;
}

/** Métriques « règles prop firm » ESTIMÉES d'après les trades loggés (renvoyées par 089). */
export interface AccountRuleMetrics {
  startingBalance: number;
  realizedPnl: number;
  currentBalance: number;
  tradesCount: number;
  winRate: number | null;
  bestDay: number | null;
  worstDay: number | null;
  objective: { current: number; target: number; pct: number } | null;
  drawdown: {
    type: DrawdownType;
    floor: number;
    margin: number;
    maxDrawdown: number;
    pct: number;
    breached: boolean;
    /** `plan` : règles officielles du plan relié ; `manual` : montant et type saisis. */
    source: 'plan' | 'manual';
    rule: DrawdownPlanRule | null;
  } | null;
  /** Plan relié dont le montant de drawdown n'est pas publié : aucun chiffre affiché. */
  drawdownUnconfirmed: boolean;
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
  /** Plan du catalogue prop firm relié au compte (`PropFirmPlanSummary.id`), sinon null. */
  propFirmPlanId: string | null;
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
  propFirmPlanId?: string | null;
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
