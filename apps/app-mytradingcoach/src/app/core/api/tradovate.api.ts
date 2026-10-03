import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@app/environments/environment';

/** Écran de départ du consentement : le retour OAuth y ramène l'utilisateur. */
export type TradovateOrigin = 'wizard' | 'settings';

export interface TradovateExternalAccount {
  id: string;
  name: string;
  /** `demo` = compte simulé (comptes de prop firm), `live` = compte réel. */
  env: 'live' | 'demo';
}

/** État d'une connexion, tel que renvoyé par l'API (jamais de token). */
export interface TradovateConnection {
  accountId: string;
  status: 'CONNECTED' | 'NEEDS_RECONNECT';
  externalAccountId: string | null;
  externalAccountName: string | null;
  externalEnv: 'live' | 'demo' | null;
  availableAccounts: TradovateExternalAccount[];
  needsAccountSelection: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  tradesImported: number;
  /** Trades importés par Tradovate ENCORE présents sur ce compte (ce que supprimerait la déconnexion). */
  brokerTradesCount: number;
  connectedAt: string;
}

export interface TradovateSyncResult {
  created: number;
  duplicates: number;
  failed: number;
  total: number;
  skipped: number;
  openPositions: number;
  feesImported: {
    assigned: number;
    expected: number;
    reconciled: boolean;
    merged?: boolean;
    count: number;
  };
  lastSyncAt: string;
}

/**
 * Connexion Tradovate PAR compte de trading. Lecture seule : aucune route
 * ici ne passe d'ordre. Le consentement se fait chez Tradovate ; l'app ne voit jamais le mot
 * de passe, seulement l'URL de redirection renvoyée par l'API.
 */
@Injectable({ providedIn: 'root' })
export class TradovateApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/integrations/tradovate`;

  connections(): Observable<{ data: TradovateConnection[] }> {
    return this.http.get<{ data: TradovateConnection[] }>(`${this.base}/connections`);
  }

  /**
   * URL de consentement Tradovate. La réponse pose aussi un cookie httpOnly de `state`
   * (l'intercepteur envoie `withCredentials`) : sans lui, le retour est refusé.
   */
  authorize(accountId: string, origin: TradovateOrigin): Observable<{ data: { url: string } }> {
    return this.http.post<{ data: { url: string } }>(
      `${this.base}/accounts/${accountId}/authorize`,
      { origin },
      { withCredentials: true },
    );
  }

  selectAccount(accountId: string, externalAccountId: string): Observable<{ data: TradovateConnection }> {
    return this.http.post<{ data: TradovateConnection }>(
      `${this.base}/accounts/${accountId}/select`,
      { externalAccountId },
    );
  }

  sync(accountId: string): Observable<{ data: TradovateSyncResult }> {
    return this.http.post<{ data: TradovateSyncResult }>(`${this.base}/accounts/${accountId}/sync`, {});
  }

  /** Relit solde et equity chez le broker (bridé côté serveur : 20 s). Jamais en boucle. */
  refreshBalance(accountId: string): Observable<{ data: unknown }> {
    return this.http.get<{ data: unknown }>(`${this.base}/accounts/${accountId}/balance`);
  }

  /**
   * `deleteTrades` → supprime aussi les trades importés par Tradovate sur ce compte (jamais les
   * saisies manuelles ni les imports CSV). `tradesDeleted: null` = connexion coupée mais
   * suppression échouée.
   */
  disconnect(
    accountId: string,
    deleteTrades = false,
  ): Observable<{ data: { disconnected: true; tradesDeleted: number | null } }> {
    return this.http.delete<{ data: { disconnected: true; tradesDeleted: number | null } }>(
      `${this.base}/accounts/${accountId}`,
      deleteTrades ? { params: { deleteTrades: 'true' } } : {},
    );
  }
}
