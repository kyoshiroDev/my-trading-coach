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

export type PayoutConfidence = 'certain' | 'probable';

/** Ajustement manuel en dessous : frais ou correction, pas un payout. */
export const PROBABLE_PAYOUT_MIN = 100;

export interface DetectedPayout {
  transactionId: string;
  confidence: PayoutConfidence;
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
 * Un payout, et à quel point on en est sûr :
 * - CERTAIN : `ChallengePayout` (type dédié, quel que soit le signe écrit), `FundTransaction`
 *   NÉGATIF (sortie d'argent ; positif = dépôt, ignoré) ;
 * - PROBABLE : `ManualAdjustment` NÉGATIF d'au moins `PROBABLE_PAYOUT_MIN`, sur un compte FUNDED.
 *   Constaté chez Apex (beta, 2026-10-04) : 3 ajustements = les 3 seules baisses de solde que le P&L
 *   n'explique pas sur 146 séances. Mais un ajustement peut aussi être une correction : affiché comme
 *   « probable », et l'utilisateur peut l'écarter. En évaluation (resets), jamais.
 * `Debit` reste exclu.
 */
export function payoutConfidence(changeType: string, delta: number, funded: boolean): PayoutConfidence | null {
  if (changeType === 'challengepayout') return delta !== 0 ? 'certain' : null;
  if (changeType === 'fundtransaction') return delta < 0 ? 'certain' : null;
  if (changeType === 'manualadjustment') return funded && delta <= -PROBABLE_PAYOUT_MIN ? 'probable' : null;
  return null;
}

/**
 * CSV du rapport `Cash History` → payouts. Colonnes (export réel) : `Account, Transaction ID,
 * Timestamp, Date, Delta, Amount, Cash Change Type, Currency, Contract`, lues par leur nom.
 */
export function scanCashHistory(csv: string, accountName: string, funded = false): CashHistoryScan {
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
    const confidence = Number.isNaN(delta) || !transactionId ? null : payoutConfidence(type, delta, funded);
    if (!confidence) continue;
    const tradeDate = sessionOf(cells[iDate], cells[iTs]);
    if (!tradeDate) continue;
    scan.payouts.push({ transactionId, tradeDate, amount: Math.abs(delta), changeType: type, confidence });
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

    // Un ajustement manuel n'est un payout probable que sur un compte funded (cycle de payout).
    const mtcAccount = await this.prisma.tradingAccount.findUnique({ where: { id: conn.accountId }, select: { type: true } });
    const funded = mtcAccount?.type === 'FUNDED';
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
          funded,
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
        data: [{
          accountId: conn.accountId, transactionId: p.transactionId, tradeDate: new Date(`${p.tradeDate}T00:00:00.000Z`),
          amount: p.amount, changeType: p.changeType, confidence: p.confidence,
        }],
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
