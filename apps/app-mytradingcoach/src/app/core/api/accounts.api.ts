import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@app/environments/environment';
import type {
  AccountIncidentReport,
  AccountIncidentSummary,
  AccountPlanHint,
  AccountStatus,
  AccountType,
  DismissIncidentResult,
  DrawdownType,
  IncidentAiState,
  PlanLinkChoice,
} from '@mtc/shared';

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
  /** `consistency`, PREMIUM : gain max de la journée en cours pour respecter la règle (null = non calculable). */
  dayCap?: number | null;
  /** `consistency`, PREMIUM : P&L de la journée en cours. */
  todayPnl?: number;
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
  /** `manual` : payout saisi dans Mes comptes ; `user` : date saisie dans le formulaire du compte. */
  cycleSource: 'broker' | 'manual' | 'user' | null;
  /** Payouts déjà reçus d'après le broker, null si inconnu. */
  payoutsReceived: number | null;
  /** Payout détecté qui fixe le cycle : `probable` = ajustement du broker, à confirmer ou écarter. */
  lastPayout: { id: string; amount: number; confidence: 'certain' | 'probable' } | null;
  unconfirmed: boolean;
}

/** Perte journalière selon la règle du plan relié (PREMIUM, #370). */
export interface DailyLossMetrics {
  limit: number;
  /** Perte du jour, ≥ 0. */
  used: number;
  remaining: number;
  /** Marge restante / limite, 0 à 1. */
  pct: number;
  breached: boolean;
  /** Sanction de la firm : compte en échec, ou trading coupé jusqu'à la séance suivante. */
  breach: 'account_failed' | 'trading_paused_for_day';
  basis: 'equity' | 'balance';
  startOfDay: number;
  source: 'broker' | 'trades';
  approximate: boolean;
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
  /** Perte journalière (PREMIUM) : null hors Premium, sans plan relié ou sans montant publié. */
  dailyLoss: DailyLossMetrics | null;
  /**
   * Solde et equity lus chez le broker (compte connecté). Présent → `currentBalance` est le solde
   * du broker et la marge se calcule sur l'equity, latent compris (sauf `referenceMismatch`).
   */
  broker: {
    cashBalance: number;
    equity: number;
    openPnl: number;
    /** Faux = position ouverte au latent jamais lu → afficher « - », pas 0. */
    openPnlKnown: boolean;
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
  /** Réponse à « Quel est ce compte ? » sans plan relié (#612) ; null = jamais demandé. */
  planLinkChoice?: PlanLinkChoice | null;
  /** Firm saisie à « Ma firm n'est pas dans la liste ». */
  unlistedFirm?: string | null;
  createdAt: string;
  updatedAt: string;
  metrics: AccountRuleMetrics;
  /**
   * Compte ACTIF dont la marge estimée avant le plancher est épuisée (plan du catalogue ou drawdown
   * saisi). Signal pour le bandeau « Plancher atteint » : aucun statut n'est changé, l'utilisateur
   * confirme. Absent des réponses qui ne le calculent pas (création, mise à jour).
   */
  floorReached?: boolean;
  /** Autopsie ouverte la plus récente (#669), pour « Voir l'autopsie ». Absent hors de la liste. */
  openIncidentId?: string | null;
  /** Compte ACTIF au-delà du quota gratuit (fin d'essai ou d'abonnement, #769). Absent hors de la liste. */
  overFreeLimit?: boolean;
}

/** Payout d'un compte : détecté chez le broker, ou saisi à la main (`manual`, supprimable). */
export interface AccountPayout {
  id: string;
  /** Séance du payout, `AAAA-MM-JJ`. */
  tradeDate: string;
  amount: number;
  manual: boolean;
  confidence: 'certain' | 'probable';
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

export type { PlanLinkChoice };

export type UpdateAccountPayload = Partial<CreateAccountPayload> & {
  status?: AccountStatus;
  planLinkChoice?: PlanLinkChoice | null;
  unlistedFirm?: string | null;
  /**
   * Feuille de choix « … est échoué » SEULEMENT (#669) : confirme la limite franchie détectée.
   * Le formulaire d'édition ne l'envoie jamais.
   */
  confirmIncident?: boolean;
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

  /** Indices stockés pour deviner le plan du compte connecté ; `data: null` sans sous-compte choisi. */
  /** Compte gardé actif en gratuit quand il y en a plusieurs (#769). */
  keep(id: string): Observable<{ data: { keptAccountId: string } }> {
    return this.http.post<{ data: { keptAccountId: string } }>(`${this.base}/${id}/keep`, {});
  }

  planHint(id: string): Observable<{ data: AccountPlanHint | null }> {
    return this.http.get<{ data: AccountPlanHint | null }>(`${this.base}/${id}/plan-hint`);
  }

  /** « Ce n'était pas un payout » : écarte un payout détecté du cycle de payout. */
  dismissPayout(accountId: string, payoutId: string): Observable<{ data: { dismissed: true } }> {
    return this.http.post<{ data: { dismissed: true } }>(`${this.base}/${accountId}/payouts/${payoutId}/dismiss`, {});
  }

  /** Payouts du compte (détectés et saisis), du plus récent au plus ancien. */
  listPayouts(id: string): Observable<{ data: AccountPayout[] }> {
    return this.http.get<{ data: AccountPayout[] }>(`${this.base}/${id}/payouts`);
  }

  /** Payout saisi à la main (compte funded sans connexion broker ; 409 si connecté). */
  addPayout(id: string, payload: { tradeDate: string; amount: number }): Observable<{ data: AccountPayout }> {
    return this.http.post<{ data: AccountPayout }>(`${this.base}/${id}/payouts`, payload);
  }

  /** Supprime un payout saisi à la main. */
  removePayout(id: string, payoutId: string): Observable<{ data: { deleted: true } }> {
    return this.http.delete<{ data: { deleted: true } }>(`${this.base}/${id}/payouts/${payoutId}`);
  }

  remove(id: string): Observable<{ data: { deleted?: boolean; archived?: boolean } }> {
    return this.http.delete<{ data: { deleted?: boolean; archived?: boolean } }>(`${this.base}/${id}`);
  }

  /** Autopsies ouvertes du compte (#669), de la plus récente à la plus ancienne. */
  incidents(id: string): Observable<{ data: AccountIncidentSummary[] }> {
    return this.http.get<{ data: AccountIncidentSummary[] }>(`${this.base}/${id}/incidents`);
  }

  /** Autopsie : chronologie, constats, analyse IA déjà générée. Aucun appel IA côté serveur. */
  incident(id: string, incidentId: string): Observable<{ data: AccountIncidentReport }> {
    return this.http.get<{ data: AccountIncidentReport }>(`${this.base}/${id}/incidents/${incidentId}`);
  }

  /** Analyse IA (Premium) : générée une seule fois à la première demande, puis conservée. */
  incidentAnalysis(id: string, incidentId: string): Observable<{ data: IncidentAiState }> {
    return this.http.get<{ data: IncidentAiState }>(`${this.base}/${id}/incidents/${incidentId}/analysis`);
  }

  /** « Ce n'est pas un échec » : retire l'autopsie, réactive le compte s'il a été fermé depuis elle. */
  dismissIncident(id: string, incidentId: string): Observable<{ data: DismissIncidentResult }> {
    return this.http.post<{ data: DismissIncidentResult }>(`${this.base}/${id}/incidents/${incidentId}/dismiss`, {});
  }

  /** Nouvelle tentative d'un compte ÉCHOUÉ : même firme, plan, taille et règles, libellé incrémenté par le serveur. */
  retry(id: string): Observable<{ data: TradingAccount }> {
    return this.http.post<{ data: TradingAccount }>(`${this.base}/${id}/retry`, {});
  }

  /**
   * Suppression DÉFINITIVE d'un compte de trading et de ses trades (compte perdu). Le compte
   * MyTradingCoach et l'abonnement ne changent pas. `confirm: true` exigé par l'API (400 sinon).
   */
  purge(id: string): Observable<{ data: { deleted: true; tradesDeleted: number } }> {
    return this.http.delete<{ data: { deleted: true; tradesDeleted: number } }>(`${this.base}/${id}/permanent`, {
      body: { confirm: true },
    });
  }
}
