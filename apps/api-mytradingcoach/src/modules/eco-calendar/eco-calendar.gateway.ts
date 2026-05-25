import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { EcoEvent } from './eco-calendar.service';

@WebSocketGateway({
  namespace: '/eco',
  cors: { origin: process.env['FRONTEND_URL'] ?? '*' },
})
export class EcoCalendarGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EcoCalendarGateway.name);

  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    this.logger.log(`WebSocket eco: client connecté ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`WebSocket eco: client déconnecté ${client.id}`);
  }

  notifyNewReleases(events: EcoEvent[]) {
    this.server.emit('eco:new-releases', { events, timestamp: new Date() });
    this.logger.log(`📡 WebSocket broadcast: ${events.length} nouveaux résultats économiques`);
  }
}
