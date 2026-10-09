import { Injectable, OnDestroy } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { SOCKET_RECONNECT_OPTIONS } from './socket-reconnect';
import { Subject } from 'rxjs';
import { environment } from '@app/environments/environment';
import type { EcoEvent } from '@mtc/shared';
import type { MarketContext } from '../api/trades.api';

// Refus du serveur (jeton expiré au handshake, SCA-B6-03) : socket.io ne retente pas seul.
// Nouvel essai espacé, le temps que l'intercepteur HTTP renouvelle le jeton.
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class EcoSocketService implements OnDestroy {
  private socket: Socket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private rejected = 0;
  readonly newReleases$ = new Subject<EcoEvent[]>();
  /** Contexte marché poussé par l'API toutes les 15 s (SCA-B4-03) : remplace le polling. */
  readonly marketContext$ = new Subject<MarketContext>();
  /** Chaque (re)connexion : l'abonné rattrape ce qui a pu être diffusé pendant la coupure. */
  readonly connected$ = new Subject<void>();

  connect() {
    // Déjà créé (connecté, en cours, ou en attente d'un nouvel essai) : pas de second socket.
    if (this.socket) return;

    this.socket = io(`${environment.wsUrl}/eco`, {
      transports: ['websocket'],
      // Fonction : relue à CHAQUE (re)connexion, donc toujours le jeton le plus récent.
      auth: (cb) => cb({ token: localStorage.getItem('access_token') ?? '' }),
      ...SOCKET_RECONNECT_OPTIONS,
    });

    this.socket.on('eco:new-releases', (data: { events: EcoEvent[] }) => {
      this.newReleases$.next(data.events);
    });

    this.socket.on('market:context', (data: { data: MarketContext }) => {
      this.marketContext$.next(data.data);
    });

    this.socket.on('connect', () => {
      if (!environment.production) console.debug('[EcoSocket] connecté');
      this.rejected = 0;
      this.connected$.next();
    });
    this.socket.on('disconnect', (reason) => {
      if (!environment.production) console.debug('[EcoSocket] déconnecté');
      if (reason === 'io server disconnect') this.scheduleRetry();
    });
  }

  disconnect() {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.rejected = 0;
    this.socket?.disconnect();
    this.socket = null;
  }

  private scheduleRetry(): void {
    if (this.retry || !this.socket) return;
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.rejected++);
    this.retry = setTimeout(() => {
      this.retry = null;
      this.socket?.connect();
    }, delay);
  }

  ngOnDestroy() {
    this.disconnect();
  }
}