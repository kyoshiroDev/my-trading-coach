import { Injectable, OnDestroy } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { SOCKET_RECONNECT_OPTIONS } from './socket-reconnect';
import { Subject } from 'rxjs';
import { environment } from '@app/environments/environment';
import type { EcoEvent } from '@mtc/shared';
import type { MarketContext } from '../api/trades.api';

@Injectable({ providedIn: 'root' })
export class EcoSocketService implements OnDestroy {
  private socket: Socket | null = null;
  readonly newReleases$ = new Subject<EcoEvent[]>();
  /** Contexte marché poussé par l'API toutes les 15 s (SCA-B4-03) : remplace le polling. */
  readonly marketContext$ = new Subject<MarketContext>();
  /** Chaque (re)connexion : l'abonné rattrape ce qui a pu être diffusé pendant la coupure. */
  readonly connected$ = new Subject<void>();

  connect() {
    if (this.socket?.connected) return;

    this.socket = io(`${environment.wsUrl}/eco`, {
      transports: ['websocket'],
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
      this.connected$.next();
    });
    this.socket.on('disconnect', () => {
      if (!environment.production) console.debug('[EcoSocket] déconnecté');
    });
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }

  ngOnDestroy() {
    this.disconnect();
  }
}