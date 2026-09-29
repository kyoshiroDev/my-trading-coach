import { Injectable, inject, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Subject } from 'rxjs';
import { environment } from '@app/environments/environment';
import { ToastService } from './toast.service';
import { SelectedAccountStore } from '../stores/selected-account.store';
import { TradovateStore } from '../stores/tradovate.store';
import { SessionStore } from '../stores/session.store';

/** Trades créés par la synchro poussée (rattrapage à l'ouverture, ou événement Tradovate). */
export interface TradovateLiveTrades {
  accountId: string;
  created: number;
  duplicates: number;
  total: number;
  source: 'catch-up' | 'live';
}

/** Après un rejet par le serveur (jeton expiré…), nouvel essai : 2 s, 4 s… plafonné à 60 s. */
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

/**
 * Temps réel Tradovate — même pattern que `EcoSocketService`, mais ouvert
 * dès que l'app l'est (monté par le shell, pas par l'écran Session live), et authentifié.
 *
 * - App ouverte → le serveur rattrape les trades faits app fermée, puis suit Tradovate en direct.
 * - Onglet fermé / logout → socket fermée → le serveur ferme le WebSocket Tradovate.
 * - Échec (API, Redis, Tradovate) → silencieux : le bouton « Synchroniser » reste le filet.
 */
@Injectable({ providedIn: 'root' })
export class TradovateLiveSocketService {
  private readonly toast = inject(ToastService);
  private readonly accounts = inject(SelectedAccountStore);
  private readonly tradovate = inject(TradovateStore);
  private readonly session = inject(SessionStore);

  private socket: Socket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private rejected = 0;

  /** Chaque import poussé : les écrans ouverts (journal, dashboard) s'y abonnent pour se recharger. */
  readonly imported$ = new Subject<TradovateLiveTrades>();
  readonly connected = signal(false);

  connect(): void {
    if (this.socket) return;
    const socket = io(`${environment.wsUrl}/tradovate-live`, {
      transports: ['websocket'],
      // Fonction : relue à CHAQUE (re)connexion, donc toujours le jeton le plus récent.
      auth: (cb) => cb({ token: localStorage.getItem('access_token') ?? '' }),
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 30_000,
    });
    this.socket = socket;

    socket.on('connect', () => {
      this.rejected = 0;
      this.connected.set(true);
    });
    socket.on('disconnect', (reason) => {
      this.connected.set(false);
      // Coupé PAR le serveur (jeton expiré au handshake) : socket.io ne retente pas seul.
      // Entre-temps l'intercepteur HTTP a pu renouveler le jeton → nouvel essai espacé.
      if (reason === 'io server disconnect') this.scheduleRetry();
    });
    socket.on('connect_error', () => this.connected.set(false));
    socket.on('tradovate:trades', (e: TradovateLiveTrades) => this.onTrades(e));
    // Connexion Tradovate à refaire : la carte « Mes comptes » l'affiche.
    socket.on('tradovate:status', () => this.tradovate.load());
  }

  disconnect(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.rejected = 0;
    const socket = this.socket;
    this.socket = null;
    this.connected.set(false);
    if (!socket) return;
    socket.removeAllListeners();
    socket.disconnect();
  }

  private scheduleRetry(): void {
    if (this.retry || !this.socket) return;
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.rejected++);
    this.retry = setTimeout(() => {
      this.retry = null;
      this.socket?.connect();
    }, delay);
  }

  private onTrades(e: TradovateLiveTrades): void {
    if (!e?.created) return;
    const s = e.created > 1 ? 's' : '';
    this.toast.success(`${e.created} trade${s} Tradovate synchronisé${s}`);
    this.accounts.load(); // soldes, P&L cumulé
    this.tradovate.load(); // « Dernière synchro » + cumul de la carte compte
    // Session en cours : le Live feed reçoit le trade sans attendre.
    if (this.session.hasActiveSession()) this.session.refreshLive();
    this.imported$.next(e);
  }
}
