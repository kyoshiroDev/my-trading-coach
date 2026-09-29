import type { Logger } from '@nestjs/common';
import { BrokerConnection, BrokerConnectionStatus, BrokerProvider } from '@prisma/client';
import type { PrismaService } from '@api/prisma/prisma.service';
import { decryptToken, encryptToken } from '@api/common/utils/token-cipher.util';
import type { TradovateApiClient } from './tradovate-api.client';
import { TradovateApiError, TradovateException } from './tradovate.errors';
import type { TradovateOAuthTokenResponse } from './tradovate.types';
import type { TradovateLocks } from './tradovate-locks';
import { REFRESH_MARGIN_MS, REFRESH_RETRY_DELAY_MS, REFUSAL_COOLDOWN_S } from './tradovate-connection.constants';

/** Colonnes de tokens chiffrés d'une connexion, prêtes à écrire en base. */
export function buildTokenColumns(
tokens: TradovateOAuthTokenResponse,
key: Buffer,
previous?: Pick<BrokerConnection, 'refreshTokenEnc' | 'refreshTokenExpiresAt'>,
) {
  const now = Date.now();
  return {
    accessTokenEnc: encryptToken(tokens.access_token as string, key),
    accessTokenExpiresAt: new Date(now + (tokens.expires_in ?? 4800) * 1000),
    // Un refresh qui ne renvoie pas de nouveau refresh_token garde l'ancien.
    refreshTokenEnc: tokens.refresh_token
      ? encryptToken(tokens.refresh_token, key)
      : (previous?.refreshTokenEnc ?? null),
    refreshTokenExpiresAt: tokens.refresh_token
      ? tokens.refresh_token_expires_in
        ? new Date(now + tokens.refresh_token_expires_in * 1000)
        : null
      : (previous?.refreshTokenExpiresAt ?? null),
  };
}

export type TokenColumns = ReturnType<typeof buildTokenColumns>;

/** Ce que le gestionnaire emprunte à TradovateConnectionService (qui reste le point d'entrée). */
export interface TokenManagerDeps {
  prisma: PrismaService;
  api: TradovateApiClient;
  locks: TradovateLocks;
  logger: Logger;
  tokenKey: () => Buffer;
  /** Attente entre deux tentatives : passe par le service pour que les tests puissent la court-circuiter. */
  wait: (ms: number) => Promise<void>;
  markNeedsReconnect: (connectionId: string, cause: string) => Promise<void>;
}

/**
 * Renouvellement des tokens Tradovate sans nouveau consentement : refresh_token (réessayé une
 * fois), repli `renewAccessToken`, verrou par login, propagation aux connexions sœurs.
 * Appelé uniquement via TradovateConnectionService.
 */
export class TradovateTokenManager {
  constructor(private readonly deps: TokenManagerDeps) {}

  /**
   * Access token valide pour cette connexion, renouvelé si besoin SANS repasser par l'écran
   * de consentement : refresh_token d'abord, puis `renewAccessToken` si l'access token vit
   * encore. Si tout échoue → connexion marquée NEEDS_RECONNECT et erreur claire.
   */
  async getAccessToken(conn: BrokerConnection): Promise<string> {
    if (conn.status === BrokerConnectionStatus.NEEDS_RECONNECT) {
      throw new TradovateException('TRADOVATE_RECONNECT_REQUIRED');
    }
    const now = Date.now();
    const current = decryptToken(conn.accessTokenEnc, this.deps.tokenKey());
    if (conn.accessTokenExpiresAt.getTime() - REFRESH_MARGIN_MS > now) return current;

    // Refus tout récent et toujours promis : on n'insiste pas auprès de Tradovate (cf. REFUSAL_COOLDOWN_S).
    if (this.refreshStillPromised(conn) && (await this.deps.locks.inRefusalCooldown(conn))) {
      throw new TradovateException('TRADOVATE_REFRESH_DEFERRED');
    }

    // `refreshTokenExpiresAt` n'est PAS une autorité : Tradovate refuse parfois avant l'échéance
    // qu'il annonce. On tente donc dès qu'un refresh_token existe, et c'est sa réponse qui tranche.
    const refreshed = conn.refreshTokenEnc ? await this.refreshWithRetry(conn) : null;
    if (refreshed) return refreshed;

    const renewed = await this.tryRenew(conn, current);
    if (renewed) return renewed;

    if (this.refreshStillPromised(conn)) {
      this.deps.logger.warn(
        `Tradovate refuse le renouvellement (connexion ${conn.id}) alors que son refresh_token vit jusqu'au ` +
          `${conn.refreshTokenExpiresAt?.toISOString()} : connexion gardée, nouvel essai dans ${REFUSAL_COOLDOWN_S / 60} min.`,
      );
      await this.deps.locks.startRefusalCooldown(conn);
      throw new TradovateException('TRADOVATE_REFRESH_DEFERRED');
    }
    await this.deps.markNeedsReconnect(conn.id, 'refresh refusé deux fois, renew impossible, refresh_token échu ou de durée inconnue');
    throw new TradovateException('TRADOVATE_RECONNECT_REQUIRED');
  }

  /**
   * Un refus n'est une preuve de mort QUE si Tradovate ne promet plus rien : tant que le
   * refresh_token est annoncé valide, un refus est traité comme passager (mesuré en prod : refus
   * d'un token frais, accepté plus tard). La connexion n'est donc condamnée qu'à l'échéance
   * annoncée, soit au pire ~25 h après le dernier renouvellement réussi. Échéance inconnue
   * (`null`) → on ne peut rien promettre, le refus tranche.
   */
  private refreshStillPromised(conn: BrokerConnection): boolean {
    return !!conn.refreshTokenEnc && !!conn.refreshTokenExpiresAt && conn.refreshTokenExpiresAt.getTime() > Date.now();
  }

  /**
   * Refresh avec UNE seconde tentative espacée : un premier `invalid_token` ne condamne plus la
   * connexion (bug prod du 2026-09-21, 4 comptes de Val perdus sur un refus unique).
   *
   * `null` = Tradovate a refusé deux fois, l'appelant décide de la suite (repli renew). Une panne
   * réseau ou une limite de débit LÈVE au contraire : on ne dégrade jamais une connexion pour
   * une indisponibilité.
   */
  private async refreshWithRetry(conn: BrokerConnection): Promise<string | null> {
    // Sérialisé PAR LOGIN : deux connexions sœurs qui renouvellent en même temps s'invalident.
    const held = await this.deps.locks.tryLoginLock(conn);
    if (!held) {
      const partage = await this.awaitSiblingRefresh(conn);
      if (partage) return partage;
      // La sœur n'a rien donné (échec de son côté, ou login inconnu) : on tente quand même,
      // comme avant. Mieux vaut un refus possible qu'une connexion bloquée par un verrou.
    }
    try {
      return await this.refreshWithRetryLocked(conn);
    } finally {
      if (held) await this.deps.locks.unlockLogin(conn);
    }
  }

  private async refreshWithRetryLocked(conn: BrokerConnection): Promise<string | null> {
    try {
      return await this.refreshWithToken(conn);
    } catch (err) {
      if (!(err instanceof TradovateApiError)) throw err;
      if (err.kind !== 'unauthorized') throw err.toException();
      this.deps.logger.warn(
        `refresh_token Tradovate refusé (connexion ${conn.id}) : 2e tentative dans ${REFRESH_RETRY_DELAY_MS} ms.`,
      );
    }

    await this.deps.wait(REFRESH_RETRY_DELAY_MS);

    // Relecture : un autre worker du cluster a pu renouveler pendant l'attente. Son access token
    // est alors déjà en base, et le réessai n'a plus lieu d'être.
    const fresh = await this.deps.prisma.brokerConnection.findUnique({ where: { id: conn.id } });
    if (!fresh || fresh.status === BrokerConnectionStatus.NEEDS_RECONNECT) return null;
    if (fresh.accessTokenExpiresAt.getTime() - REFRESH_MARGIN_MS > Date.now()) {
      this.deps.logger.log(`Token Tradovate déjà renouvelé ailleurs (connexion ${conn.id}).`);
      return decryptToken(fresh.accessTokenEnc, this.deps.tokenKey());
    }
    if (!fresh.refreshTokenEnc) return null;

    try {
      return await this.refreshWithToken(fresh);
    } catch (err) {
      if (!(err instanceof TradovateApiError)) throw err;
      if (err.kind !== 'unauthorized') throw err.toException();
      this.deps.logger.warn(`refresh_token Tradovate refusé 2 fois (connexion ${conn.id}) : repli renew.`);
      return null;
    }
  }

  /**
   * Repli natif Tradovate : prolonge un access token ENCORE VIVANT. C'est le filet du refresh,
   * d'où la marge de 40 min — expiré, ce chemin n'existe plus. `null` = pas de filet disponible.
   */
  private async tryRenew(conn: BrokerConnection, current: string): Promise<string | null> {
    if (conn.accessTokenExpiresAt.getTime() <= Date.now()) return null;
    try {
      const renewed = await this.deps.api.renewAccessToken(current);
      await this.deps.prisma.brokerConnection.update({
        where: { id: conn.id },
        data: {
          accessTokenEnc: encryptToken(renewed.accessToken, this.deps.tokenKey()),
          accessTokenExpiresAt: new Date(renewed.expirationTime),
        },
      });
      return renewed.accessToken;
    } catch (err) {
      if (err instanceof TradovateApiError && err.kind !== 'unauthorized') throw err.toException();
      return null;
    }
  }

  /**
   * Renouvellement IMMÉDIAT par refresh_token, sans lire de données (cron de maintien).
   * `reconnect` = Tradovate refuse le refresh_token (expiré, révoqué) : la connexion est
   * marquée à reconnecter. `retry` = Tradovate injoignable ou limité : on ne touche à rien,
   * le passage suivant réessaiera — jamais de connexion dégradée pour une panne réseau.
   */
  async refreshNow(conn: BrokerConnection): Promise<'refreshed' | 'reconnect' | 'retry'> {
    if (!conn.refreshTokenEnc) {
      await this.deps.markNeedsReconnect(conn.id, 'aucun refresh_token stocké');
      return 'reconnect';
    }
    if (this.refreshStillPromised(conn) && (await this.deps.locks.inRefusalCooldown(conn))) return 'retry';
    try {
      // Même exigence que la synchro : deux refus ET aucun repli avant de condamner.
      if (await this.refreshWithRetry(conn)) return 'refreshed';
      const current = decryptToken(conn.accessTokenEnc, this.deps.tokenKey());
      if (await this.tryRenew(conn, current)) return 'refreshed';
      if (this.refreshStillPromised(conn)) {
        this.deps.logger.warn(`Renouvellement Tradovate refusé mais refresh_token encore valide (connexion ${conn.id}) : reporté.`);
        await this.deps.locks.startRefusalCooldown(conn);
        return 'retry';
      }
      await this.deps.markNeedsReconnect(conn.id, 'cron : refresh refusé deux fois, refresh_token échu ou de durée inconnue');
      return 'reconnect';
    } catch (err) {
      this.deps.logger.warn(`Renouvellement Tradovate reporté (connexion ${conn.id}) : ${(err as Error).message}`);
      return 'retry';
    }
  }

  /**
   * Seconde chance d'une connexion « à reconnecter » dont le refresh_token est encore annoncé
   * valide : condamnée à tort (refus passager, rotation d'une sœur avant le verrou par login).
   * Un renouvellement réussi la remet CONNECTED sans rien demander à l'utilisateur.
   */
  async tryRevive(conn: BrokerConnection): Promise<boolean> {
    if (conn.status !== BrokerConnectionStatus.NEEDS_RECONNECT || !this.refreshStillPromised(conn)) return false;
    try {
      const held = await this.deps.locks.tryLoginLock(conn);
      try {
        await this.refreshWithToken(conn);
      } finally {
        if (held) await this.deps.locks.unlockLogin(conn);
      }
    } catch (err) {
      this.deps.logger.warn(`Connexion Tradovate ${conn.id} toujours refusée : ${(err as Error).message}`);
      return false;
    }
    await this.deps.prisma.brokerConnection.update({
      where: { id: conn.id },
      data: { status: BrokerConnectionStatus.CONNECTED, lastSyncError: null },
    });
    this.deps.logger.log(`Connexion Tradovate ${conn.id} ressuscitée : le login a de nouveau accepté le refresh.`);
    return true;
  }

  /**
   * Échange le refresh_token (rotation incluse), persiste les nouveaux tokens chiffrés, puis les
   * PROPAGE aux connexions sœurs du même login : elles détiennent la même autorisation OAuth, et
   * sans ça leur copie vient d'être invalidée par cette rotation.
   */
  private async refreshWithToken(conn: BrokerConnection): Promise<string> {
    const tokens = await this.deps.api.refresh(decryptToken(conn.refreshTokenEnc as string, this.deps.tokenKey()));
    const columns = buildTokenColumns(tokens, this.deps.tokenKey(), conn);
    await this.deps.prisma.brokerConnection.update({ where: { id: conn.id }, data: columns });
    await this.deps.locks.clearRefusalCooldown(conn);
    await this.propagateToSiblings(conn, columns);
    return tokens.access_token as string;
  }

  /**
   * Diffuse les tokens fraîchement obtenus à toutes les connexions du MÊME login (même user MTC,
   * même `externalUserId`). Une sœur passée « à reconnecter » par une rotation concurrente l'a été
   * à tort : le login vient de répondre, donc elle repart CONNECTED.
   *
   * Sans `externalUserId` (connexions d'avant cette correction), on ne sait pas qui est sœur de qui :
   * on ne propage rien plutôt que de deviner.
   */
  private async propagateToSiblings(
    conn: BrokerConnection,
    columns: TokenColumns,
  ): Promise<number> {
    if (!conn.externalUserId) return 0;
    const { count } = await this.deps.prisma.brokerConnection.updateMany({
      where: {
        id: { not: conn.id },
        userId: conn.userId,
        provider: BrokerProvider.TRADOVATE,
        externalUserId: conn.externalUserId,
      },
      data: { ...columns, status: BrokerConnectionStatus.CONNECTED, lastSyncError: null },
    });
    if (count > 0) {
      this.deps.logger.log(`Token Tradovate propagé à ${count} connexion(s) sœur(s) du login ${conn.externalUserId}.`);
    }
    return count;
  }

  /**
   * Rattrapage du login pour les connexions créées avant cette correction : leur `externalUserId`
   * est vide, donc elles ne sont sœurs de personne et ne bénéficient ni du verrou partagé ni de la
   * propagation. La synchro lit déjà `/account/list`, qui porte le `userId` : on le pose au passage,
   * une seule fois, sans appel réseau supplémentaire.
   */
  async rememberLogin(
    conn: BrokerConnection,
    externalUserId: number | undefined,
    accountIdsOfLogin: string[] = [],
  ): Promise<number> {
    if (externalUserId == null) return 0;
    const login = String(externalUserId);
    // Tous les comptes que CE login expose : c'est ce qui permet de rattacher aussi les connexions
    // sœurs DÉJÀ MORTES. Elles ne se synchronisent plus (le cron ignore NEEDS_RECONNECT), donc
    // elles ne passeraient jamais ici d'elles-mêmes et resteraient orphelines — donc jamais
    // ressuscitées par la propagation.
    const ids = accountIdsOfLogin.length
      ? accountIdsOfLogin
      : conn.externalAccountId
        ? [conn.externalAccountId]
        : [];
    if (ids.length === 0) return 0;
    const { count } = await this.deps.prisma.brokerConnection.updateMany({
      where: {
        userId: conn.userId,
        provider: BrokerProvider.TRADOVATE,
        externalUserId: null,
        externalAccountId: { in: ids },
      },
      data: { externalUserId: login },
    });
    if (count > 0) {
      this.deps.logger.log(`Login Tradovate ${login} rattaché à ${count} connexion(s).`);
    }
    return count;
  }

  /**
   * Une connexion sœur renouvelle en ce moment : plutôt que de présenter un refresh_token qu'elle
   * est en train de remplacer, on attend puis on relit. Si elle a propagé, son access token est
   * déjà en base et il n'y a plus rien à demander à Tradovate.
   */
  private async awaitSiblingRefresh(conn: BrokerConnection): Promise<string | null> {
    await this.deps.wait(REFRESH_RETRY_DELAY_MS);
    const fresh = await this.deps.prisma.brokerConnection.findUnique({ where: { id: conn.id } });
    if (!fresh || fresh.status === BrokerConnectionStatus.NEEDS_RECONNECT) return null;
    if (fresh.accessTokenExpiresAt.getTime() - REFRESH_MARGIN_MS > Date.now()) {
      this.deps.logger.log(`Token Tradovate repris d'une connexion sœur (connexion ${conn.id}).`);
      return decryptToken(fresh.accessTokenEnc, this.deps.tokenKey());
    }
    return null;
  }
}
