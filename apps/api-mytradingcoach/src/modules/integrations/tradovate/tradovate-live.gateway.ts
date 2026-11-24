import type { OnModuleDestroy } from '@nestjs/common';
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
import { BehaviorAlertsService } from '../../behavior/behavior-alerts.service';
import { NewsShieldService } from '../../behavior/news-shield.service';

export const userRoom = (userId: string) => `user:${userId}`;
/** Passage du bouclier annonces (#670). */
export const NEWS_SHIELD_TICK_MS = 60_000;

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
export class TradovateLiveGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  /** Bouclier annonces (#670) : passage « avant l'annonce », chaque minute, sur ce worker. */
  private newsTimer: ReturnType<typeof setInterval> | null = null;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly live: TradovateLiveService,
    private readonly alerts: PropAlertsService,
    private readonly tilt: TiltAlertsService,
    private readonly behavior: BehaviorAlertsService,
    private readonly newsShield: NewsShieldService,
  ) {}

  afterInit(): void {
    this.live.bindEmitter((userId, event, payload) => {
      const room = this.server.to(userRoom(userId));
      room.emit(event, payload);
      // Nouveau solde : alertes prop firm (Premium) évaluées sur le worker titulaire, une fois.
      // Nouveaux trades reçus EN DIRECT : anti-tilt (Premium), même worker, une fois. Pas sur le
      // rattrapage à l'ouverture de l'app : un nudge après coup n'a plus de sens.
      // Anti-tilt : sur un trade NOUVEAU seulement (une position mise à jour n'est pas un trade de plus).
      if (event === 'tradovate:trades' && (payload as LiveTradesEvent).source === 'live' && (payload as LiveTradesEvent).created > 0) {
        this.tilt.schedule(userId, (payload as LiveTradesEvent).accountId, (e, p) => {
          this.server.to(userRoom(userId)).emit(e, p);
        });
      }
      if (event === 'tradovate:balance') {
        this.alerts.schedule(userId, (payload as BrokerBalanceView).accountId, (e, p) => {
          this.server.to(userRoom(userId)).emit(e, p);
        });
        // Positions relues par la synchro : nouvelles entrées → détecteurs de comportement (#602).
        // Phase 1 silencieuse : enregistrées, émises seulement si BEHAVIOR_ALERTS_UI=true.
        this.behavior.schedule(userId, (payload as BrokerBalanceView).accountId, (e, p) => {
          this.server.to(userRoom(userId)).emit(e, p);
        });
      }
    });
    this.startNewsShield();
  }

  /**
   * Bouclier annonces (#670) : positions déjà ouvertes sur les connexions dont CE worker tient le
   * WebSocket (positions à jour), émises par la même room que les autres alertes. Seulement si
   * `NEWS_SHIELD_ENABLED=true` ; le tick ne lève jamais.
   */
  private startNewsShield(): void {
    if (!this.newsShield.enabled || this.newsTimer) return;
    this.newsTimer = setInterval(() => {
      void this.newsShield.tick(new Date(), this.live.ownedConnections(), (userId) => (e, p) => {
        this.server.to(userRoom(userId)).emit(e, p);
      });
    }, NEWS_SHIELD_TICK_MS);
    this.newsTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.newsTimer) clearInterval(this.newsTimer);
    this.newsTimer = null;
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
