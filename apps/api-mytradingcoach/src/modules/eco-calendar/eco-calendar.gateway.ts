import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { RedisService } from '../shared/redis.service';
import { EcoEvent } from './eco-calendar.service';

@WebSocketGateway({
  namespace: '/eco',
  cors: { origin: process.env['FRONTEND_URL'] ?? 'http://localhost:4200' },
})
export class EcoCalendarGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(EcoCalendarGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly redisService: RedisService) {}

  afterInit(server: Server) {
    const pubClient = this.redisService.client;
    const subClient = pubClient.duplicate();
    server.adapter(createAdapter(pubClient, subClient));
    this.logger.log('WebSocket Redis adapter activé — compatible multi-workers');
  }

  handleConnection(client: Socket) {
    this.logger.log(`WebSocket eco: client connecté ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`WebSocket eco: client déconnecté ${client.id}`);
  }

  notifyNewReleases(events: EcoEvent[]) {
    this.server.emit('eco:new-releases', { events, timestamp: new Date() });
    this.logger.log(`📡 WebSocket broadcast: ${events.length} résultats économiques`);
  }
}
