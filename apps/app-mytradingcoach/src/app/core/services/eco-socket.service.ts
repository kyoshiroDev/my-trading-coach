import { Injectable, OnDestroy } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { EcoEvent } from '../api/eco-calendar.api';

@Injectable({ providedIn: 'root' })
export class EcoSocketService implements OnDestroy {
  private socket: Socket | null = null;
  readonly newReleases$ = new Subject<EcoEvent[]>();

  connect() {
    if (this.socket?.connected) return;

    this.socket = io(`${environment.wsUrl}/eco`, {
      transports: ['websocket'],
    });

    this.socket.on('eco:new-releases', (data: { events: EcoEvent[] }) => {
      this.newReleases$.next(data.events);
    });

    this.socket.on('connect', () => {
      if (!environment.production) console.debug('[EcoSocket] connecté');
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