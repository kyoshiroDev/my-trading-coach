import { Injectable, Logger } from '@nestjs/common';
import { BrokerConnection } from '@prisma/client';
import { TradesService } from '../../trades/trades.service';
import { CsvImportService, type FeesReport } from '../../trades/csv-import.service';
import { TradovateApiClient } from './tradovate-api.client';
import { TradovateConnectionService } from './tradovate-connection.service';
import { TradovateReportingClient, type ReportWindow } from './tradovate-reporting.client';
import { TradovateApiError, TradovateException } from './tradovate.errors';
import type { TradovateAccount, TradovateEnv } from './tradovate.types';

/**
 * Profondeur par défaut. Chaque mois = 2 appels (Performance + Cash History), soit ~1 s pour
 * 6 mois : on peut se permettre de remonter large, d'autant que la plupart des comptes n'ont
 * pas d'historique au-delà.
 */
export const HISTORY_DEFAULT_MONTHS = 6;
/**
 * Deux mois vides d'affilée = on s'arrête. Un mois creux arrive (vacances, compte en pause) ;
 * deux de suite signifient qu'on a dépassé le début du compte. Évite de tirer 6 rapports vides.
 */
const EMPTY_WINDOWS_BEFORE_STOP = 2;
/** Petite pause entre fenêtres : la limite documentée est de 5 000 requêtes/h, on en fait 12. */
const PAUSE_BETWEEN_WINDOWS_MS = 300;

export interface HistoryImportResult {
  created: number;
  duplicates: number;
  failed: number;
  /** Fenêtres mensuelles réellement interrogées. */
  windows: number;
  /** Fenêtres sans aucun trade. */
  empty: number;
  /** Rapprochement des frais, cumulé sur les fenêtres (null si aucun frais lu). */
  fees: FeesReport | null;
}

/**
 * Import de l'HISTORIQUE d'un compte Tradovate via la Reporting API (PROMPT-217).
 *
 * La synchro live (Trade API) ne voit que la séance en cours : un trader qui connecte son compte
 * un mardi perd tout son passé. La Reporting API, elle, sert des fenêtres mensuelles — c'est le
 * seul chemin vers l'historique confirmé par le support NinjaTrader (2026-09-23).
 *
 * **Rien n'est réécrit ici** : le CSV renvoyé par l'API est byte-compatible avec l'export
 * « Performance » que l'import CSV sait déjà lire (même en-tête `buyFillId`/`sellFillId`, mêmes
 * colonnes, même P&L comptable `$(8.50)`), et le Cash History avec le fichier de frais attendu
 * (`Transaction ID` / `Delta` / `Cash Change Type`, lignes `Commission`). On passe donc par
 * `CsvImportService` puis `TradesService.importTrades` : même mapping, même dédup, mêmes setups
 * que l'import manuel — y compris la dédup inter-sources (CSV sans fuseau ↔ API en UTC), qui
 * évite les doublons avec les trades déjà remontés par la synchro live.
 *
 * ⏳ **Importer TÔT** : Tradovate archive un compte inactif ou en échec au bout de 10 jours, et
 * son historique devient alors illisible. D'où le déclenchement dès la connexion.
 */
@Injectable()
export class TradovateHistoryService {
  private readonly logger = new Logger(TradovateHistoryService.name);

  constructor(
    private readonly api: TradovateApiClient,
    private readonly connections: TradovateConnectionService,
    private readonly reporting: TradovateReportingClient,
    private readonly csvImport: CsvImportService,
    private readonly trades: TradesService,
  ) {}

  /** Entrée par compte MTC : résout la connexion puis importe. */
  async importForAccount(
    userId: string,
    accountId: string,
    options: { months?: number } = {},
  ): Promise<HistoryImportResult> {
    const conn = await this.connections.getConnection(userId, accountId);
    return this.importHistory(userId, conn, options);
  }

  async importHistory(
    userId: string,
    conn: BrokerConnection,
    options: { months?: number } = {},
  ): Promise<HistoryImportResult> {
    if (!conn.externalAccountId || !conn.externalEnv) {
      throw new TradovateException('TRADOVATE_ACCOUNT_SELECTION_REQUIRED');
    }
    const env = conn.externalEnv as TradovateEnv;
    const token = await this.connections.getAccessToken(conn);
    const accountName = await this.resolveAccountName(env, token, conn);

    const months = Math.max(1, options.months ?? HISTORY_DEFAULT_MONTHS);
    const result: HistoryImportResult = {
      created: 0, duplicates: 0, failed: 0, windows: 0, empty: 0, fees: null,
    };
    let consecutiveEmpty = 0;

    for (const window of this.monthlyWindows(months, accountName)) {
      if (consecutiveEmpty >= EMPTY_WINDOWS_BEFORE_STOP) break;
      result.windows++;
      try {
        const imported = await this.importWindow(userId, conn, env, token, window, result);
        consecutiveEmpty = imported ? 0 : consecutiveEmpty + 1;
        if (!imported) result.empty++;
      } catch (err) {
        // Un jeton mort arrête tout : les fenêtres suivantes échoueraient pareil.
        if (err instanceof TradovateApiError && err.kind === 'unauthorized') throw err.toException();
        // Le reste (fenêtre refusée, rapport illisible) ne doit pas priver l'utilisateur des
        // autres mois : on compte l'échec et on continue.
        result.failed++;
        this.logger.warn(
          `Import historique : fenêtre ${window.from.toISOString().slice(0, 10)} ignorée (${(err as Error).message}).`,
        );
      }
      await this.wait(PAUSE_BETWEEN_WINDOWS_MS);
    }

    this.logger.log(
      `Import historique Tradovate (compte ${accountName}) : ${result.created} créé(s), ` +
        `${result.duplicates} doublon(s), ${result.failed} échec(s) sur ${result.windows} fenêtre(s).`,
    );
    return result;
  }

  /** Une fenêtre : Performance (les trades) + Cash History (les frais). */
  private async importWindow(
    userId: string,
    conn: BrokerConnection,
    env: TradovateEnv,
    token: string,
    window: ReportWindow,
    result: HistoryImportResult,
  ): Promise<boolean> {
    const performance = await this.reporting.fetchCsv(env, token, 'Performance', window);
    // Un mois sans trade renvoie un CSV vide : ce n'est pas une erreur.
    if (!performance || performance.split(/\r?\n/).filter((l) => l.trim()).length < 2) return false;

    // Les frais sont un bonus : leur absence donne un P&L brut, jamais un import raté.
    let cash = '';
    try {
      cash = await this.reporting.fetchCsv(env, token, 'Cash History', window);
    } catch (err) {
      this.logger.warn(`Frais indisponibles sur la fenêtre (${(err as Error).message}) : P&L brut.`);
    }

    const report: { fees?: FeesReport } = {};
    const dtos = await this.csvImport.parseCSV(
      Buffer.from(performance, 'utf8'),
      'tradovate-performance.csv',
      userId,
      undefined,
      undefined,
      { accountId: conn.accountId },
      cash ? { buffer: Buffer.from(cash, 'utf8'), filename: 'tradovate-cash-history.csv' } : undefined,
      report,
    );
    if (dtos.length === 0) return false;

    const imported = await this.trades.importTrades(userId, dtos);
    result.created += imported.created;
    result.duplicates += imported.duplicates;
    result.failed += imported.failed;
    if (report.fees) result.fees = this.mergeFees(result.fees, report.fees);
    return true;
  }

  /**
   * Le nom du compte chez Tradovate, relu à CHAQUE import : celui stocké en base peut être périmé
   * (constaté en prod le 2026-09-26, une connexion portait un nom que le login n'expose plus), et
   * la Reporting API filtre par nom — un nom périmé donne « account is not found ».
   */
  private async resolveAccountName(
    env: TradovateEnv,
    token: string,
    conn: BrokerConnection,
  ): Promise<string> {
    const accounts = await this.api.get<TradovateAccount[]>(env, '/account/list', token);
    const account = (Array.isArray(accounts) ? accounts : []).find(
      (a) => String(a.id) === conn.externalAccountId,
    );
    if (!account) throw new TradovateException('TRADOVATE_ACCOUNT_NOT_FOUND');
    return account.name;
  }

  /** Fenêtres mensuelles, de la plus récente à la plus ancienne (bornes inclusives). */
  private monthlyWindows(months: number, accountName: string): ReportWindow[] {
    const windows: ReportWindow[] = [];
    const now = new Date();
    for (let i = 0; i < months; i++) {
      const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0));
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      // Le mois en cours s'arrête aujourd'hui, pas à une date future.
      windows.push({ from, to: to > now ? now : to, accountName });
    }
    return windows;
  }

  private mergeFees(a: FeesReport | null, b: FeesReport): FeesReport {
    if (!a) return b;
    const assigned = +(a.assigned + b.assigned).toFixed(2);
    const expected = +(a.expected + b.expected).toFixed(2);
    return {
      assigned,
      expected,
      reconciled: a.reconciled && b.reconciled,
      merged: a.merged !== false && b.merged !== false,
      count: a.count + b.count,
    };
  }

  /** Isolé pour que les tests n'attendent pas réellement. */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
