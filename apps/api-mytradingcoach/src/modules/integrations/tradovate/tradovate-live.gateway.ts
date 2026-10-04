import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '@api/prisma/prisma.service';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { TradovateLiveService } from './tradovate-live.service';
import type { BrokerBalanceView } from './tradovate-balance.service';
import { PropAlertsService } from './prop-alerts.service';
import { TiltAlertsService } from './tilt-alerts.service';
import type { LiveTradesEvent } from './tradovate-live.service';

export const userRoom = (userId: string) => `user:${userId}`;

/**
 * Canal applicatif du temps réel Tradovate — même pattern que `/eco`,
 * mais AUTHENTIFIÉ : les événements portent des trades, ils ne partent qu'au bon user.
 *
 * - Handshake : `auth.token` = access_token de l'app (JWT). Invalide, ou compte démo
 *   (lecture seule, aucune vraie connexion Tradovate) → déconnexion immédiate.
 * - Chaque client rejoint `user:<id>` : l'adapter Redis (main.ts) relaie les émissions du
 *   worker titulaire du WebSocket Tradovate vers les onglets connectés à d'autres workers.
 * - Le JWT n'est vérifié qu'au handshake ; le client en renvoie un frais à chaque reconnexion.
 */
@WebSocketGateway({
  namespace: '/tradovate-live',
  cors: { origin: process.env['FRONTEND_URL'] ?? 'http://localhost:4200' },
})
export class TradovateLiveGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly live: TradovateLiveService,
    private readonly alerts: PropAlertsService,
    private readonly tilt: TiltAlertsService,
  ) {}

  afterInit(): void {
    this.live.bindEmitter((userId, event, payload) => {
      const room = this.server.to(userRoom(userId));
      room.emit(event, payload);
      // Nouveau solde : alertes prop firm (Premium) évaluées sur le worker titulaire, une fois.
      // Nouveaux trades reçus EN DIRECT : anti-tilt (Premium), même worker, une fois. Pas sur le
      // rattrapage à l'ouverture de l'app : un nudge après coup n'a plus de sens.
      if (event === 'tradovate:trades' && (payload as LiveTradesEvent).source === 'live') {
        this.tilt.schedule(userId, (payload as LiveTradesEvent).accountId, (e, p) => {
          this.server.to(userRoom(userId)).emit(e, p);
        });
      }
      if (event === 'tradovate:balance') {
        this.alerts.schedule(userId, (payload as BrokerBalanceView).accountId, (e, p) => {
          this.server.to(userRoom(userId)).emit(e, p);
        });
      }
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    const userId = await this.authenticate(client);
    if (!userId) {
      client.disconnect(true);
      return;
    }
    // Parti pendant la vérification : ne pas enregistrer un client fantôme.
    if (!client.connected) return;
    (client.data as { userId?: string }).userId = userId;
    await client.join(userRoom(userId));
    await this.live.attach(userId, client.id);
  }

  handleDisconnect(client: Socket): void {
    const userId = (client.data as { userId?: string }).userId;
    if (userId) this.live.detach(userId, client.id);
  }

  private async authenticate(client: Socket): Promise<string | null> {
    const token = (client.handshake.auth as { token?: unknown } | undefined)?.token;
    if (typeof token !== 'string' || !token) return null;
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, isDemo: true },
      });
      return user && !user.isDemo ? user.id : null;
    } catch {
      return null; // jeton expiré ou falsifié : le client reviendra avec un jeton frais
    }
  }
}
