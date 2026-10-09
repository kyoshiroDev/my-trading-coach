import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { EcoEvent } from '@mtc/shared';

// Messages client → serveur : aucun n'est attendu sur /eco (diffusion seule). 100 Ko suffisent
// largement et bornent ce qu'un client peut faire tamponner au serveur (SCA-B6-03).
export const ECO_MAX_HTTP_BUFFER_SIZE = 1e5;

@WebSocketGateway({
  namespace: '/eco',
  cors: { origin: process.env['FRONTEND_URL'] ?? 'http://localhost:4200' },
  maxHttpBufferSize: ECO_MAX_HTTP_BUFFER_SIZE,
  pingInterval: 25_000,
})
export class EcoCalendarGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(EcoCalendarGateway.name);

  constructor(private readonly jwt: JwtService) {}

  @WebSocketServer()
  server!: Server;

  afterInit(_server: Server) {
    this.logger.log('WebSocket EcoCalendar Gateway initialisé');
  }

  /**
   * Jeton de l'app exigé au handshake (SCA-B6-03) : seuls les utilisateurs connectés (démo
   * comprise, ces données sont communes à tous) reçoivent le flux. Signature vérifiée seulement,
   * sans requête en base : la connexion doit rester bon marché quand tous les onglets reviennent.
   */
  async handleConnection(client: Socket) {
    const token = (client.handshake.auth as { token?: unknown } | undefined)?.token;
    const ok = typeof token === 'string' && token !== '' && (await this.jwt.verifyAsync(token).then(() => true, () => false));
    if (!ok) {
      this.logger.debug(`WebSocket eco: refusé (jeton absent ou invalide) ${client.id}`);
      client.disconnect(true);
      return;
    }
    this.logger.debug(`WebSocket eco: client connecté ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`WebSocket eco: client déconnecté ${client.id}`);
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
