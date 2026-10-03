import { Injectable, Logger } from '@nestjs/common';
import type { BrokerConnection } from '@prisma/client';
import { PrismaService } from '@api/prisma/prisma.service';
import { TradovateApiClient } from './tradovate-api.client';
import { TradovateConnectionService } from './tradovate-connection.service';
import type { TradovateCashBalanceSnapshot, TradovateEnv } from './tradovate.types';

/**
 * Un rafraîchissement demandé par l'utilisateur (ouverture de « Mes comptes », bouton
 * « Actualiser ») ne relit pas le broker si le dernier instantané a moins de ce délai : plusieurs
 * onglets ou clics répétés ne font qu'UN appel.
 */
export const BALANCE_REFRESH_MIN_MS = 20_000;

/** Solde et equity du compte chez le broker, tels que stockés sur la connexion. */
export interface BrokerBalanceView {
  accountId: string;
  cashBalance: number | null;
  cashBalanceAt: Date | null;
  netLiq: number | null;
  openPnl: number | null;
  equityAt: Date | null;
  openPositions: number;
}

export function toBalanceView(conn: Pick<BrokerConnection,
  'accountId' | 'brokerCashBalance' | 'brokerCashBalanceAt' | 'brokerNetLiq' | 'brokerOpenPnl' |
  'brokerEquityAt' | 'brokerOpenPositions'>): BrokerBalanceView {
  return {
    accountId: conn.accountId,
    cashBalance: conn.brokerCashBalance,
    cashBalanceAt: conn.brokerCashBalanceAt,
    netLiq: conn.brokerNetLiq,
    openPnl: conn.brokerOpenPnl,
    equityAt: conn.brokerEquityAt,
    openPositions: conn.brokerOpenPositions,
  };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Solde et equity RÉELS du compte, lus chez le broker (feature « solde en direct »).
 *
 * - Solde réalisé : poussé en temps réel par le WebSocket (`cashBalance`) quand l'app est ouverte
 *   (`recordCashBalance`), relu par l'instantané sinon.
 * - Equity et latent : `getcashbalancesnapshot`, calculés par le broker avec SES cotations. Lu sur
 *   ÉVÉNEMENT seulement — fin de synchro (trade, cron, rattrapage) et demande de l'utilisateur
 *   bridée à `BALANCE_REFRESH_MIN_MS`. Jamais en boucle : la doc NinjaTrader qualifie
 *   l'interrogation répétée de cette route d'anti-pattern.
 *
 * Toujours best-effort : un échec n'interrompt ni la synchro ni la page, l'ancienne valeur reste
 * (avec sa date, affichée).
 */
@Injectable()
export class TradovateBalanceService {
  private readonly logger = new Logger(TradovateBalanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: TradovateApiClient,
    private readonly connections: TradovateConnectionService,
  ) {}

  /** Lit l'instantané et le persiste. `openPositions` : compté par l'appelant s'il le connaît. */
  async captureSnapshot(
    conn: BrokerConnection,
    token: string,
    apiHosts: unknown,
    openPositions?: number,
  ): Promise<BrokerBalanceView | null> {
    if (!conn.externalAccountId || !conn.externalEnv) return null;
    let snap: TradovateCashBalanceSnapshot;
    try {
      snap = await this.api.postRead<TradovateCashBalanceSnapshot>(
        conn.externalEnv as TradovateEnv,
        '/cashBalance/getcashbalancesnapshot',
        token,
        { accountId: Number(conn.externalAccountId) },
        apiHosts,
      );
    } catch (err) {
      this.logger.warn(`Instantané de solde indisponible (connexion ${conn.id}) : ${(err as Error).message}`);
      return null;
    }
    const now = new Date();
    const updated = await this.prisma.brokerConnection.update({
      where: { id: conn.id },
      data: {
        ...(finite(snap.totalCashValue) ? { brokerCashBalance: snap.totalCashValue, brokerCashBalanceAt: now } : {}),
        brokerNetLiq: finite(snap.netLiq) ? snap.netLiq : null,
        brokerOpenPnl: finite(snap.openPnL) ? snap.openPnL : null,
        brokerEquityAt: now,
        ...(openPositions !== undefined ? { brokerOpenPositions: openPositions } : {}),
      },
    });
    return toBalanceView(updated);
  }

  /** Solde réalisé poussé par le WebSocket. Sans position ouverte, l'equity est ce solde. */
  async recordCashBalance(connectionId: string, amount: number, at: Date): Promise<BrokerBalanceView | null> {
    if (!finite(amount)) return null;
    const conn = await this.prisma.brokerConnection.findUnique({ where: { id: connectionId } });
    if (!conn) return null;
    // Un événement plus ancien que la valeur stockée (rejeu à la reconnexion) ne la remplace pas.
    if (conn.brokerCashBalanceAt && conn.brokerCashBalanceAt > at) return toBalanceView(conn);
    const flat = conn.brokerOpenPositions === 0;
    const updated = await this.prisma.brokerConnection.update({
      where: { id: connectionId },
      data: {
        brokerCashBalance: amount,
        brokerCashBalanceAt: at,
        ...(flat ? { brokerNetLiq: amount, brokerOpenPnl: 0, brokerEquityAt: at } : {}),
      },
    });
    return toBalanceView(updated);
  }

  /** Nombre de positions ouvertes vu par le WebSocket (instantané initial de la souscription). */
  async recordOpenPositions(connectionId: string, openPositions: number): Promise<void> {
    await this.prisma.brokerConnection
      .update({ where: { id: connectionId }, data: { brokerOpenPositions: openPositions } })
      .catch(() => undefined);
  }

  /**
   * Rafraîchissement demandé par l'utilisateur pour UN compte. Bridé : instantané de moins de
   * `BALANCE_REFRESH_MIN_MS` → renvoyé tel quel, sans appel au broker.
   */
  async refresh(userId: string, accountId: string): Promise<BrokerBalanceView> {
    const conn = await this.connections.getConnection(userId, accountId);
    const fresh = conn.brokerEquityAt && Date.now() - conn.brokerEquityAt.getTime() < BALANCE_REFRESH_MIN_MS;
    if (fresh || !conn.externalAccountId || conn.status !== 'CONNECTED') return toBalanceView(conn);
    // Jeton indisponible (à reconnecter, verrou, compte démo au jeton factice) : la dernière
    // valeur connue, avec sa date. La page n'échoue jamais pour ça.
    const session = await this.connections.getSession(conn).catch(() => null);
    if (!session) return toBalanceView(conn);
    return (await this.captureSnapshot(conn, session.token, session.apiHosts)) ?? toBalanceView(conn);
  }
}
