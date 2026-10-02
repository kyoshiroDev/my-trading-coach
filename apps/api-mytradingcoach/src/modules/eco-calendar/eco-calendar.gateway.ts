import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import type { EcoEvent } from '@mtc/shared';

@WebSocketGateway({
  namespace: '/eco',
  cors: { origin: process.env['FRONTEND_URL'] ?? 'http://localhost:4200' },
})
export class EcoCalendarGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(EcoCalendarGateway.name);

  @WebSocketServer()
  server!: Server;

  afterInit(_server: Server) {
    this.logger.log('WebSocket EcoCalendar Gateway initialisé');
  }

  handleConnection(client: Socket) {
    this.logger.log(`WebSocket eco: client connecté ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`WebSocket eco: client déconnecté ${client.id}`);
  }

  /** Nombre de clients /eco, tous workers confondus (adaptateur Redis de socket.io). */
  async connectedCount(): Promise<number> {
    return (await this.server.fetchSockets()).length;
  }

  /** Contexte marché commun à tous (SCA-B4-03) : poussé au lieu d'être interrogé par chaque onglet. */
  notifyMarketContext(data: unknown) {
    this.server.emit('market:context', { data, timestamp: new Date() });
  }

  notifyNewReleases(events: EcoEvent[]) {
    this.server.emit('eco:new-releases', { events, timestamp: new Date() });
    this.logger.log(`📡 WebSocket broadcast: ${events.length} résultats économiques`);
  }
}
