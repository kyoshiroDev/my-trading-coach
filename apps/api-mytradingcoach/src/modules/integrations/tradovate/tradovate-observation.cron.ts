import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AccountStatus, BrokerConnection, BrokerConnectionStatus, BrokerProvider, Prisma } from '@prisma/client';
import { PrismaService } from '@api/prisma/prisma.service';
import { TradovateApiClient } from './tradovate-api.client';
import { TradovateConnectionService } from './tradovate-connection.service';
import { TradovatePenaltyError } from './tradovate.errors';
import { syncPauseReason } from './tradovate-sync-pause';
import type { TradovateEnv } from './tradovate.types';
import { classifyFailure, OBSERVATION_RETENTION_DAYS, observationDay, readListedAccount } from './tradovate-observation';

type ObservedConnection = BrokerConnection & { account: { status: AccountStatus; statusChangedAt: Date | null } };

/**
 * Journal d'observation Tradovate (#684, phase 2) — OBSERVE, ne décide rien.
 *
 * Une fois par jour, ce que `/account/list` dit du compte de chaque connexion `CONNECTED` : présent
 * ou non, `active`, `closed`, `restricted`, et l'issue de l'appel (code HTTP, refus, pénalité). Une
 * ligne par connexion et par jour dans `TradovateAccountObservation`, lue plus tard par Greg en SQL
 * pour fixer (ou non) un signal « compte fermé chez Tradovate ». Aucune synchro, aucun statut,
 * aucune pause ne dépend de ce journal.
 *
 * - **Comptes en pause (#684) compris** : ce sont eux qu'on veut voir, le cron de fond ne les lit plus.
 * - **Un appel par login et par jour** : les sœurs d'un même login (même utilisateur MTC, même hôte)
 *   partagent la liste. Coût négligeable devant le cron de fond (22 à 44 appels/h par connexion).
 * - Même verrou que la synchro et le cron des jetons (rotation du refresh_token). Login occupé sur
 *   toutes ses connexions : sauté pour la journée, rien d'écrit.
 * - Une pénalité reçue est notée sur le login (`notePenalty`), comme ailleurs. Une pause en cours :
 *   aucun appel, ligne `PENALIZED`.
 * - Comptes démo exclus. Journal : des nombres seulement, ni identifiant, ni jeton, ni montant.
 * - Idempotent : `@@unique([connectionId, day])`, un second passage du même jour n'écrit rien.
 * - Purge des lignes de plus de `OBSERVATION_RETENTION_DAYS` jours au même passage.
 */
@Injectable()
export class TradovateObservationCron {
  private readonly logger = new Logger(TradovateObservationCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: TradovateConnectionService,
    private readonly api: TradovateApiClient,
  ) {}

  // 06:40 : hors des quarts d'heure du cron de fond et de la minute 17 du cron des jetons.
  @Cron('40 6 * * *', { timeZone: 'Europe/Paris' })
  async scheduledObserve(): Promise<void> {
    await this.observe();
  }

  async observe(now = new Date()): Promise<{
    observed: number;
    listed: number;
    missing: number;
    closed: number;
    failed: number;
    skipped: number;
    calls: number;
  }> {
    const result = { observed: 0, listed: 0, missing: 0, closed: 0, failed: 0, skipped: 0, calls: 0 };
    try {
      this.connections.assertConfigured();
    } catch {
      return result;
    }

    const day = observationDay(now);
    const conns: ObservedConnection[] = await this.prisma.brokerConnection.findMany({
      where: {
        provider: BrokerProvider.TRADOVATE,
        status: BrokerConnectionStatus.CONNECTED,
        externalAccountId: { not: null },
        externalEnv: { not: null },
        user: { isDemo: false },
        observations: { none: { day } },
      },
      include: { account: { select: { status: true, statusChangedAt: true } } },
      orderBy: { createdAt: 'asc' },
    });

    // Sœurs d'un login : même utilisateur MTC (la propagation des jetons s'arrête là) et même hôte.
    const groups = new Map<string, ObservedConnection[]>();
    for (const c of conns) {
      const key = `${c.userId}|${c.externalUserId ?? `conn:${c.id}`}|${c.externalEnv}`;
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }

    for (const group of groups.values()) {
      const read = await this.readList(group, result);
      if (!read) {
        result.skipped += group.length;
        continue;
      }
      const rows: Prisma.TradovateAccountObservationCreateManyInput[] = group.map((c) => {
        const seen = read.ok
          ? readListedAccount(read.list, c.externalAccountId)
          : { listed: null, active: null, closed: null, restricted: null };
        if (seen.listed === true) result.listed++;
        if (seen.listed === false) result.missing++;
        if (seen.closed === true) result.closed++;
        if (!read.ok) result.failed++;
        return {
          connectionId: c.id,
          day,
          outcome: read.outcome,
          httpStatus: read.httpStatus,
          ...seen,
          accountStatus: c.account.status,
          syncPaused: syncPauseReason(c.account, c.historyImportedAt, now) !== null,
          lastSyncAt: c.lastSyncAt,
        };
      });
      const { count } = await this.prisma.tradovateAccountObservation.createMany({ data: rows, skipDuplicates: true });
      result.observed += count;
    }

    const cutoff = new Date(day.getTime() - OBSERVATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.tradovateAccountObservation.deleteMany({ where: { day: { lt: cutoff } } });

    if (conns.length > 0) {
      this.logger.log(
        `Observation Tradovate : ${result.observed} connexion(s) notée(s) en ${result.calls} appel(s), ` +
          `${result.listed} listée(s), ${result.missing} absente(s), ${result.closed} « closed », ` +
          `${result.failed} sans liste, ${result.skipped} sautée(s) (synchro en cours).`,
      );
    }
    return result;
  }

  /**
   * `/account/list` lue avec la première connexion du login qu'on peut verrouiller. `null` : toutes
   * occupées. Jamais d'exception : un échec devient une issue à noter.
   */
  private async readList(
    group: ObservedConnection[],
    result: { calls: number },
  ): Promise<
    | { ok: true; list: unknown; outcome: 'OK'; httpStatus: number }
    | ({ ok: false; list: null } & ReturnType<typeof classifyFailure>)
    | null
  > {
    for (const conn of group) {
      if (!(await this.connections.tryLock(conn.id))) continue;
      try {
        const { token, apiHosts } = await this.connections.getSession(conn);
        result.calls++;
        const list = await this.api.get<unknown>(conn.externalEnv as TradovateEnv, '/account/list', token, undefined, apiHosts);
        return { ok: true, list, outcome: 'OK', httpStatus: 200 };
      } catch (err) {
        if (err instanceof TradovatePenaltyError) await this.connections.notePenalty(conn, err).catch(() => undefined);
        return { ok: false, list: null, ...classifyFailure(err) };
      } finally {
        await this.connections.unlock(conn.id);
      }
    }
    return null;
  }
}
