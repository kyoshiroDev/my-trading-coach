import { Injectable, Logger } from '@nestjs/common';
import type { BrokerConnection } from '@prisma/client';
import { PrismaService } from '@api/prisma/prisma.service';
import { splitCsvLine } from '../../trades/csv-parsers';
import { tradingDay } from '../../accounts/account-rules';
import { TradovateApiClient } from './tradovate-api.client';
import { TradovateReportingClient } from './tradovate-reporting.client';
import { TradovateApiError } from './tradovate.errors';
import { CLOSINGS_WINDOW_DAYS, parseReportAmount } from './tradovate-closings.service';
import type { TradovateAccount, TradovateEnv } from './tradovate.types';

const DAY_MS = 86_400_000;
/** Sans date de création lisible : un an d'historique de trésorerie. */
const PAYOUTS_FALLBACK_DAYS = 365;

/** `" Trade Paired"` → `tradepaired` : le rapport écrit les types en libellés lisibles. */
export function normalizeChangeType(raw: string | undefined): string {
  return (raw ?? '').replace(/[^a-z]/gi, '').toLowerCase();
}

export interface DetectedPayout {
  transactionId: string;
  /** `AAAA-MM-JJ` */
  tradeDate: string;
  /** Montant retiré, positif. */
  amount: number;
  changeType: string;
}

export interface CashHistoryScan {
  payouts: DetectedPayout[];
  /** Nombre de lignes par type normalisé : sert à vérifier, sur de vrais comptes, quel type
   *  porte réellement les payouts (journalisé, jamais de montant). */
  typeCounts: Record<string, number>;
}

/**
 * Un payout = un RETRAIT certain :
 * - `ChallengePayout` (type dédié aux payouts de prop firm), quel que soit le signe écrit ;
 * - `FundTransaction` NÉGATIF (sortie d'argent ; positif = dépôt, ignoré).
 * `ManualAdjustment` et `Debit` sont exclus : ils servent aussi aux resets et aux corrections, et un
 * faux payout ferait repartir le cycle à tort. À revoir sur données réelles (cf. `typeCounts`).
 */
export function isPayout(changeType: string, delta: number): boolean {
  if (changeType === 'challengepayout') return delta !== 0;
  if (changeType === 'fundtransaction') return delta < 0;
  return false;
}

/**
 * CSV du rapport `Cash History` → payouts. Colonnes (export réel) : `Account, Transaction ID,
 * Timestamp, Date, Delta, Amount, Cash Change Type, Currency, Contract`, lues par leur nom.
 */
export function scanCashHistory(csv: string, accountName: string): CashHistoryScan {
  const scan: CashHistoryScan = { payouts: [], typeCounts: {} };
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return scan;
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (n: string) => header.indexOf(n);
  const [iAccount, iTxn, iDate, iTs, iDelta, iType] =
    ['account', 'transaction id', 'date', 'timestamp', 'delta', 'cash change type'].map(col);
  if (iTxn < 0 || iDelta < 0 || iType < 0) return scan;
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    if (iAccount >= 0 && cells[iAccount]?.trim() && cells[iAccount].trim() !== accountName) continue;
    const type = normalizeChangeType(cells[iType]);
    if (!type) continue;
    scan.typeCounts[type] = (scan.typeCounts[type] ?? 0) + 1;
    const delta = parseReportAmount(cells[iDelta]);
    const transactionId = cells[iTxn]?.trim() ?? '';
    if (Number.isNaN(delta) || !transactionId || !isPayout(type, delta)) continue;
    const tradeDate = sessionOf(cells[iDate], cells[iTs]);
    if (!tradeDate) continue;
    scan.payouts.push({ transactionId, tradeDate, amount: Math.abs(delta), changeType: type });
  }
  return scan;
}

/** Date de séance : colonne `Date` (AAAA-MM-JJ), sinon journée de trading de l'horodatage UTC. */
function sessionOf(date: string | undefined, timestamp: string | undefined): string | null {
  const d = date?.trim() ?? '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(timestamp?.trim() ?? '');
  if (!m) return null;
  return tradingDay(new Date(Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +m[6])));
}

/**
 * Payouts reçus, détectés dans l'historique de trésorerie du broker (rapport `Cash History`, même
 * jeton OAuth que l'import). Remplace la saisie « dernier payout reçu le » quand il trouve plus
 * récent, et donne le RANG du prochain payout (paliers).
 *
 * - Curseur `BrokerConnection.payoutsCheckedThrough` : on repart de la dernière séance couverte
 *   (relue), pas de toute la vie du compte à chaque passage.
 * - Idempotent : une transaction n'est enregistrée qu'une fois (`@@unique([accountId, transactionId])`).
 * - Best-effort ; un jeton refusé remonte.
 */
@Injectable()
export class TradovatePayoutsService {
  private readonly logger = new Logger(TradovatePayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: TradovateApiClient,
    private readonly reporting: TradovateReportingClient,
  ) {}

  /** Nombre de payouts nouvellement enregistrés. */
  async refresh(conn: BrokerConnection, token: string, apiHosts: unknown, now = new Date()): Promise<number> {
    if (!conn.externalAccountId || !conn.externalEnv) return 0;
    const env = conn.externalEnv as TradovateEnv;
    const accounts = await this.api.get<TradovateAccount[]>(env, '/account/list', token, undefined, apiHosts);
    const account = (Array.isArray(accounts) ? accounts : []).find((a) => String(a.id) === conn.externalAccountId);
    if (!account) return 0;

    const created = account.timestamp ? new Date(account.timestamp) : null;
    const start = conn.payoutsCheckedThrough
      ?? (created && !Number.isNaN(created.getTime()) && created < now ? created : new Date(now.getTime() - PAYOUTS_FALLBACK_DAYS * DAY_MS));

    const typeCounts: Record<string, number> = {};
    const payouts: DetectedPayout[] = [];
    let complete = true;
    for (let from = startOfUtcDay(start); from <= now; from = new Date(from.getTime() + CLOSINGS_WINDOW_DAYS * DAY_MS)) {
      const to = new Date(Math.min(from.getTime() + (CLOSINGS_WINDOW_DAYS - 1) * DAY_MS, now.getTime()));
      try {
        const scan = scanCashHistory(
          await this.reporting.fetchCsv(env, token, 'Cash History', { from, to, accountName: account.name }, apiHosts),
          account.name,
        );
        payouts.push(...scan.payouts);
        for (const [t, n] of Object.entries(scan.typeCounts)) typeCounts[t] = (typeCounts[t] ?? 0) + n;
      } catch (err) {
        if (err instanceof TradovateApiError && err.kind === 'unauthorized') throw err;
        complete = false;
        this.logger.warn(`Payouts : fenêtre ${from.toISOString().slice(0, 10)} ignorée (${(err as Error).message}).`);
      }
    }

    let created_ = 0;
    for (const p of payouts) {
      const res = await this.prisma.brokerPayout.createMany({
        data: [{ accountId: conn.accountId, transactionId: p.transactionId, tradeDate: new Date(`${p.tradeDate}T00:00:00.000Z`), amount: p.amount, changeType: p.changeType }],
        skipDuplicates: true,
      });
      created_ += res.count;
    }
    // Le curseur n'avance que si toutes les fenêtres ont abouti : un trou serait sinon définitif.
    if (complete) {
      await this.prisma.brokerConnection.update({
        where: { id: conn.id },
        data: { payoutsCheckedThrough: new Date(`${tradingDay(now)}T00:00:00.000Z`) },
      });
    }
    // Types vus (comptes, jamais de montant) : de quoi vérifier sur de vrais comptes que les payouts
    // passent bien par ChallengePayout / FundTransaction.
    const types = Object.entries(typeCounts).map(([t, n]) => `${t}×${n}`).join(', ') || 'aucune ligne';
    this.logger.log(`Payouts (compte ${account.name}) : ${created_} nouveau(x) ; types lus : ${types}.`);
    return created_;
  }
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
