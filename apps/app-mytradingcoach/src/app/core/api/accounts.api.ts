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
  /** Origine du plus haut retenu (trailing EOD) : clôtures officielles ou trades ; null hors EOD. */
  peakSource: 'broker' | 'trades' | null;
  /** Plus haut solde de clôture retenu, null hors EOD. */
  peakBalance: number | null;
  /** Dernière séance couverte par les clôtures officielles (`AAAA-MM-JJ`), sinon null. */
  officialThrough: string | null;
  /** Plateforme dont la règle de verrouillage a été appliquée, sinon null. */
  platform: string | null;
  /** Plateforme inconnue alors que le verrouillage en dépend : choix à proposer. */
  platformChoices: string[];
}

export type ProgressRequirementKey =
  | 'profit' | 'trading_days' | 'consistency' | 'winning_days' | 'cycle_profit' | 'safety_net';

export interface ProgressRequirement {
  key: ProgressRequirementKey;
  met: boolean;
  current: number;
  required: number;
  unit: 'usd' | 'days' | 'pct';
  threshold?: number | null;
}

/** Progression vers l'objectif (évaluation) ou le prochain payout (funded), d'après le plan. */
export interface AccountProgress {
  kind: 'objective' | 'payout';
  remaining: number;
  done: boolean;
  requirements: ProgressRequirement[];
  /** Séance du dernier payout (le cycle commence après), null = depuis le début. */
  cycleAfter: string | null;
  /** Payout détecté chez le broker, ou date saisie par l'utilisateur. */
  cycleSource: 'broker' | 'user' | null;
  /** Payouts déjà reçus d'après le broker, null si inconnu. */
  payoutsReceived: number | null;
  /** Payout détecté qui fixe le cycle : `probable` = ajustement du broker, à confirmer ou écarter. */
  lastPayout: { id: string; amount: number; confidence: 'certain' | 'probable' } | null;
  unconfirmed: boolean;
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
  /** Progression vers l'objectif ou le prochain payout (plan relié), sinon null. */
  progress: AccountProgress | null;
  /**
   * Solde et equity lus chez le broker (compte connecté). Présent → `currentBalance` est le solde
   * du broker et la marge se calcule sur l'equity, latent compris (sauf `referenceMismatch`).
   */
  broker: {
    cashBalance: number;
    equity: number;
    openPnl: number;
    openPositions: number;
    balanceAt: string | null;
    equityAt: string | null;
    referenceMismatch: boolean;
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
  /** Plan du catalogue prop firm relié au compte (`PropFirmPlanSummary.id`), sinon null. */
  propFirmPlanId: string | null;
  /** Plateforme de trading (clé du catalogue : `tradovate`, `rithmic`…), sinon null. */
  platform: string | null;
  /** Séance du dernier payout reçu (`AAAA-MM-JJ…`), sinon null. */
  lastPayoutAt: string | null;
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
  platform?: string | null;
  lastPayoutAt?: string | null;
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

  /** « Ce n'était pas un payout » : écarte un payout détecté du cycle de payout. */
  dismissPayout(accountId: string, payoutId: string): Observable<{ data: { dismissed: true } }> {
    return this.http.post<{ data: { dismissed: true } }>(`${this.base}/${accountId}/payouts/${payoutId}/dismiss`, {});
  }

  remove(id: string): Observable<{ data: { deleted?: boolean; archived?: boolean } }> {
    return this.http.delete<{ data: { deleted?: boolean; archived?: boolean } }>(`${this.base}/${id}`);
  }
}
