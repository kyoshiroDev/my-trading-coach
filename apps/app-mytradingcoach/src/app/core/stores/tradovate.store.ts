import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, map, tap } from 'rxjs';
import {
  TradovateApi,
  TradovateConnection,
  TradovateOrigin,
  TradovateSyncResult,
} from '../api/tradovate.api';
import { syncResultLines } from '../utils/tradovate-return.util';

/** Action en cours sur un compte : pilote les spinners et désactive les boutons. */
export type TradovateBusy = 'sync' | 'select' | 'disconnect' | 'connect';

export interface TradovateFeedback {
  lines: { text: string; warn: boolean }[];
  error: string | null;
}

/** Message lisible d'une erreur API (le back envoie toujours un message FR clair + un code). */
export function tradovateErrorText(err: unknown, fallback: string): string {
  const e = err instanceof HttpErrorResponse ? err.error : (err as { error?: unknown })?.error;
  const msg = (e as { message?: unknown } | null)?.message;
  return typeof msg === 'string' && msg ? msg : fallback;
}

/**
 * État des connexions Tradovate, PAR compte de trading (PROMPT-208). Partagé par le wizard et
 * « Mes comptes ». Chaque action (synchro, choix du compte, déconnexion) est suivie compte par
 * compte : deux comptes (Apex + Lucid) vivent indépendamment.
 */
@Injectable({ providedIn: 'root' })
export class TradovateStore {
  private readonly api = inject(TradovateApi);

  readonly connections = signal<TradovateConnection[]>([]);
  readonly loaded = signal(false);
  readonly busy = signal<Record<string, TradovateBusy | undefined>>({});
  readonly feedback = signal<Record<string, TradovateFeedback | undefined>>({});

  readonly byAccount = computed(
    () => new Map(this.connections().map((c) => [c.accountId, c] as const)),
  );

  load(): void {
    this.api.connections().subscribe({
      next: (res) => {
        this.connections.set(res.data ?? []);
        this.loaded.set(true);
      },
      // Liste indisponible : les comptes s'affichent quand même, en « Non connecté ».
      error: () => this.loaded.set(true),
    });
  }

  /** URL de consentement : l'appelant redirige le navigateur (cf. écran de réassurance). */
  authorizeUrl(accountId: string, origin: TradovateOrigin): Observable<string> {
    return this.api.authorize(accountId, origin).pipe(map((res) => res.data.url));
  }

  sync(accountId: string, done?: (r: TradovateSyncResult | null) => void): void {
    if (this.busy()[accountId]) return; // double-clic
    this.setBusy(accountId, 'sync');
    this.setFeedback(accountId, undefined);
    this.api.sync(accountId).subscribe({
      next: (res) => {
        this.setBusy(accountId, undefined);
        this.setFeedback(accountId, { lines: syncResultLines(res.data), error: null });
        this.load(); // dernière synchro + cumul à jour
        done?.(res.data);
      },
      error: (err) => {
        this.setBusy(accountId, undefined);
        this.setFeedback(accountId, {
          lines: [],
          error: tradovateErrorText(err, 'La synchronisation a échoué. Réessaie dans un instant.'),
        });
        this.load(); // l'API a pu passer la connexion en « à reconnecter »
        done?.(null);
      },
    });
  }

  /** Choix du compte Tradovate (login à plusieurs comptes), puis première synchro. */
  selectThenSync(
    accountId: string,
    externalAccountId: string,
    done?: (r: TradovateSyncResult | null) => void,
  ): void {
    if (this.busy()[accountId]) return;
    this.setBusy(accountId, 'select');
    this.api.selectAccount(accountId, externalAccountId).pipe(
      tap((res) => this.upsert(res.data)),
    ).subscribe({
      next: () => {
        this.setBusy(accountId, undefined);
        this.sync(accountId, done);
      },
      error: (err) => {
        this.setBusy(accountId, undefined);
        this.setFeedback(accountId, {
          lines: [],
          error: tradovateErrorText(err, "Ce compte Tradovate n'a pas pu être choisi."),
        });
        done?.(null);
      },
    });
  }

  disconnect(accountId: string): void {
    if (this.busy()[accountId]) return;
    this.setBusy(accountId, 'disconnect');
    this.api.disconnect(accountId).subscribe({
      next: () => this.afterDisconnect(accountId),
      error: (err) => {
        // 404 = déjà déconnecté : c'est l'objectif, pas une erreur (cf. angular.md).
        if (err instanceof HttpErrorResponse && err.status === 404) {
          this.afterDisconnect(accountId);
          return;
        }
        this.setBusy(accountId, undefined);
        this.setFeedback(accountId, {
          lines: [],
          error: tradovateErrorText(err, 'La déconnexion a échoué. Réessaie.'),
        });
      },
    });
  }

  setFeedback(accountId: string, fb: TradovateFeedback | undefined): void {
    this.feedback.update((m) => ({ ...m, [accountId]: fb }));
  }

  private afterDisconnect(accountId: string): void {
    this.setBusy(accountId, undefined);
    this.connections.update((list) => list.filter((c) => c.accountId !== accountId));
    this.setFeedback(accountId, {
      lines: [{ text: 'Compte déconnecté. Tes trades déjà importés restent dans ton journal.', warn: false }],
      error: null,
    });
  }

  private upsert(conn: TradovateConnection): void {
    this.connections.update((list) => [
      ...list.filter((c) => c.accountId !== conn.accountId),
      conn,
    ]);
  }

  private setBusy(accountId: string, b: TradovateBusy | undefined): void {
    this.busy.update((m) => ({ ...m, [accountId]: b }));
  }
}
