import { Injectable, Logger } from '@nestjs/common';
import type { BrokerConnection } from '@prisma/client';
import { PrismaService } from '@api/prisma/prisma.service';
import { splitCsvLine } from '../../trades/csv-parsers';
import { tradingDay } from '../../accounts/account-rules';
import { TradovateApiClient } from './tradovate-api.client';
import { TradovateReportingClient } from './tradovate-reporting.client';
import { TradovateApiError } from './tradovate.errors';
import type { TradovateAccount, TradovateEnv } from './tradovate.types';

/**
 * Largeur d'une fenêtre de rapport. Mesuré : 63 jours passent sur les rapports de trades, 92 sont
 * refusés ; `Account Balance History` a accepté 120 jours sur un compte quasi vide, ce qui ne
 * prouve rien sur un compte actif. On reste sous la limite connue.
 */
export const CLOSINGS_WINDOW_DAYS = 60;
/** Sans date de création lisible : un an de clôtures, au-delà le plus haut est rarement utile. */
const CLOSINGS_FALLBACK_DAYS = 365;
const DAY_MS = 86_400_000;

export interface DailyClose {
  /** Journée de trading `AAAA-MM-JJ` (date de séance, telle que le broker la libelle). */
  tradeDate: string;
  closingBalance: number;
  realizedPnl: number;
}

/**
 * Montant du rapport : `"50,000.00"` (guillemets, séparateur de milliers), `(125.50)` pour un
 * négatif, `$` possible. `NaN` si illisible.
 */
export function parseReportAmount(raw: string | undefined): number {
  if (raw == null) return Number.NaN;
  let s = raw.replace(/["$\s]/g, '').replace(/,/g, '');
  let sign = 1;
  if (s.startsWith('(') && s.endsWith(')')) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return Number.NaN;
  return sign * Number(s);
}

/**
 * CSV du rapport `Account Balance History` → clôtures. Colonnes mesurées le 2026-10-03 :
 * `Account ID, Account Name, Trade Date, Total Amount, Total Realized PNL`. Repérées par leur nom
 * (l'ordre n'est pas contractuel) ; ligne illisible ignorée, jamais devinée.
 */
export function parseAccountBalanceHistory(csv: string, accountName: string): DailyClose[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iName = col('account name');
  const iDate = col('trade date');
  const iTotal = col('total amount');
  const iPnl = col('total realized pnl');
  if (iDate < 0 || iTotal < 0) return [];
  const rows: DailyClose[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    if (iName >= 0 && cells[iName]?.trim() && cells[iName].trim() !== accountName) continue;
    const tradeDate = cells[iDate]?.trim() ?? '';
    const closingBalance = parseReportAmount(cells[iTotal]);
    const realizedPnl = iPnl >= 0 ? parseReportAmount(cells[iPnl]) : 0;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate) || Number.isNaN(closingBalance)) continue;
    rows.push({ tradeDate, closingBalance, realizedPnl: Number.isNaN(realizedPnl) ? 0 : realizedPnl });
  }
  return rows;
}

/**
 * Soldes de clôture OFFICIELS du compte, par journée de trading (rapport `Account Balance
 * History`, même jeton OAuth que l'import : aucune permission en plus).
 *
 * - Incrémental : on reprend à la dernière journée stockée (relue, au cas où le broker l'aurait
 *   corrigée), sinon depuis la création du compte.
 * - La séance EN COURS n'est jamais stockée : son « Total Amount » n'est pas encore une clôture
 *   (le broker ne le garantit qu'après la fermeture). Elle le sera au passage suivant.
 * - Best-effort : un échec n'interrompt pas la synchro ; un jeton refusé remonte.
 */
@Injectable()
export class TradovateClosingsService {
  private readonly logger = new Logger(TradovateClosingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: TradovateApiClient,
    private readonly reporting: TradovateReportingClient,
  ) {}

  /** Nombre de clôtures écrites (créées ou corrigées). */
  async refresh(conn: BrokerConnection, token: string, apiHosts: unknown, now = new Date()): Promise<number> {
    if (!conn.externalAccountId || !conn.externalEnv) return 0;
    const env = conn.externalEnv as TradovateEnv;

    // Nom (le rapport filtre par NOM, celui stocké peut être périmé) et date de création.
    const accounts = await this.api.get<TradovateAccount[]>(env, '/account/list', token, undefined, apiHosts);
    const account = (Array.isArray(accounts) ? accounts : []).find((a) => String(a.id) === conn.externalAccountId);
    if (!account) return 0;

    const last = await this.prisma.brokerDailyClose.findFirst({
      where: { accountId: conn.accountId },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    });
    const created = account.timestamp ? new Date(account.timestamp) : null;
    const start = last
      ? last.tradeDate
      : created && !Number.isNaN(created.getTime()) && created < now
        ? created
        : new Date(now.getTime() - CLOSINGS_FALLBACK_DAYS * DAY_MS);
    const currentSession = tradingDay(now);

    const closes: DailyClose[] = [];
    for (let from = startOfUtcDay(start); from <= now; from = new Date(from.getTime() + CLOSINGS_WINDOW_DAYS * DAY_MS)) {
      const to = new Date(Math.min(from.getTime() + (CLOSINGS_WINDOW_DAYS - 1) * DAY_MS, now.getTime()));
      try {
        const csv = await this.reporting.fetchCsv(env, token, 'Account Balance History', { from, to, accountName: account.name }, apiHosts);
        closes.push(...parseAccountBalanceHistory(csv, account.name));
      } catch (err) {
        if (err instanceof TradovateApiError && err.kind === 'unauthorized') throw err;
        this.logger.warn(`Clôtures officielles : fenêtre ${from.toISOString().slice(0, 10)} ignorée (${(err as Error).message}).`);
      }
    }

    // Séance en cours (ou future, horloge décalée) : pas encore une clôture.
    const closed = closes.filter((c) => c.tradeDate < currentSession);
    for (const c of closed) {
      const tradeDate = new Date(`${c.tradeDate}T00:00:00.000Z`);
      await this.prisma.brokerDailyClose.upsert({
        where: { accountId_tradeDate: { accountId: conn.accountId, tradeDate } },
        create: { accountId: conn.accountId, tradeDate, closingBalance: c.closingBalance, realizedPnl: c.realizedPnl },
        update: { closingBalance: c.closingBalance, realizedPnl: c.realizedPnl },
      });
    }
    if (closed.length) {
      this.logger.log(`Clôtures officielles (compte ${account.name}) : ${closed.length} journée(s) enregistrée(s).`);
    }
    return closed.length;
  }
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
