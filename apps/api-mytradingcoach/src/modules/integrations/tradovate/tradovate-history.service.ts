import { Injectable, Logger } from '@nestjs/common';
import { BrokerConnection, TradeSource } from '@prisma/client';
import { TradesService } from '../../trades/trades.service';
import { SetupsService } from '../../setups/setups.service';
import { preprocessCsv, mapNormalizedCsvToDto, type ImportDto } from '../../trades/csv-parsers';
import { assignFeesOncePerFill } from '../../trades/tradovate-pair.util';
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
  /** Commissions réellement attribuées aux trades, cumulées sur les fenêtres. */
  feesAssigned: number;
  /** Σ des commissions vues dans le rapport Fills (checksum attendu). */
  feesExpected: number;
}

/**
 * Import de l'HISTORIQUE d'un compte Tradovate via la Reporting API (PROMPT-217).
 *
 * La synchro live (Trade API) ne voit que la séance en cours : un trader qui connecte son compte
 * un mardi perd tout son passé. La Reporting API, elle, sert des fenêtres mensuelles — c'est le
 * seul chemin vers l'historique confirmé par le support NinjaTrader (2026-09-23).
 *
 * **Aucun mapping n'est réécrit** : le CSV renvoyé par l'API est byte-compatible avec l'export
 * « Performance » que l'import CSV sait déjà lire (même en-tête `buyFillId`/`sellFillId`, mêmes
 * colonnes, même P&L comptable `$(8.50)`). On réutilise donc ses parseurs purs
 * (`preprocessCsv` + `mapNormalizedCsvToDto`) puis `TradesService.importTrades` : même dédup que
 * l'import manuel — y compris la dédup inter-sources (CSV sans fuseau ↔ API en UTC), qui évite
 * les doublons avec les trades déjà remontés par la synchro live.
 *
 * Seule différence assumée avec l'import CSV : les **frais viennent du rapport `Fills`**, pas du
 * `Cash History` (cf. `importWindow`).
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
    private readonly setups: SetupsService,
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
      created: 0, duplicates: 0, failed: 0, windows: 0, empty: 0, feesAssigned: 0, feesExpected: 0,
    };
    // Setup « Sans setup » : créé une fois pour tout l'import, comme le fait l'import CSV.
    const setupId = await this.setups.getImportSetupId(userId);
    let consecutiveEmpty = 0;

    for (const window of this.monthlyWindows(months, accountName)) {
      if (consecutiveEmpty >= EMPTY_WINDOWS_BEFORE_STOP) break;
      result.windows++;
      try {
        const imported = await this.importWindow(userId, conn, env, token, window, setupId, result);
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

  /**
   * Une fenêtre : `Performance` (les trades appariés) + `Fills` (les commissions).
   *
   * Les frais viennent de `Fills` et NON de `Cash History`, malgré ce que fait l'import CSV
   * manuel : celui-ci relie une commission à son fill par la convention `txnId − 1 = fillId`,
   * qui **ne tient pas** sur les comptes testés (0 correspondance sur 291 le 2026-09-26, avec un
   * décalage variable d'une ligne à l'autre). `Fills` porte le `Fill ID` ET sa `commission` :
   * la jointure est exacte, vérifiée à 291/291 et au centime (266,40 $).
   */
  private async importWindow(
    userId: string,
    conn: BrokerConnection,
    env: TradovateEnv,
    token: string,
    window: ReportWindow,
    setupId: string | null,
    result: HistoryImportResult,
  ): Promise<boolean> {
    const performance = await this.reporting.fetchCsv(env, token, 'Performance', window);
    // Un mois sans trade renvoie un CSV vide : ce n'est pas une erreur.
    if (!performance) return false;

    const { broker, csv } = preprocessCsv(performance);
    if (broker !== 'tradovate') {
      throw new Error(`rapport Performance non reconnu (détecté « ${broker} »)`);
    }
    const dtos = mapNormalizedCsvToDto(csv);
    if (dtos.length === 0) return false;

    // Les frais sont un bonus : leur absence donne un P&L brut, jamais un import raté.
    try {
      result.feesExpected += await this.applyFees(env, token, window, dtos);
    } catch (err) {
      this.logger.warn(`Frais indisponibles sur la fenêtre (${(err as Error).message}) : P&L brut.`);
    }
    result.feesAssigned = +(
      result.feesAssigned + dtos.reduce((sum, d) => sum + (d.commission ?? 0), 0)
    ).toFixed(2);

    // Mêmes défauts que l'import CSV : compte cible, setup d'import, émotion non renseignée.
    for (const d of dtos) {
      d.accountId = conn.accountId;
      d.emotion = null;
      if (setupId) d.setupId = setupId;
    }
    // Les ids de fill sont des métadonnées de rapprochement : jamais persistées.
    const clean = dtos.map(({ _buyFillId: _b, _sellFillId: _s, ...rest }) => rest);

    const imported = await this.trades.importTrades(userId, clean, TradeSource.BROKER_HISTORY);
    result.created += imported.created;
    result.duplicates += imported.duplicates;
    result.failed += imported.failed;
    return true;
  }

  /** Commissions du rapport `Fills`, attribuées une seule fois par fill. Renvoie le total attendu. */
  private async applyFees(
    env: TradovateEnv,
    token: string,
    window: ReportWindow,
    dtos: ImportDto[],
  ): Promise<number> {
    const csv = await this.reporting.fetchCsv(env, token, 'Fills', window);
    if (!csv) return 0;
    const lines = csv.split(/\r?\n/).filter((l) => l.trim());
    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const iId = header.indexOf('fill id');
    const iFee = header.indexOf('commission');
    if (iId < 0 || iFee < 0) {
      this.logger.warn('Rapport Fills sans colonne « Fill ID » ou « commission » : P&L brut.');
      return 0;
    }
    const feeByFill = new Map<string, number>();
    let expected = 0;
    for (const line of lines.slice(1)) {
      const cols = line.split(',');
      const id = (cols[iId] ?? '').trim();
      const fee = Math.abs(parseFloat((cols[iFee] ?? '').trim()) || 0);
      if (!id || fee <= 0) continue;
      feeByFill.set(id, fee);
      expected += fee;
    }
    const { assigned, consumed } = assignFeesOncePerFill(dtos, feeByFill);
    this.logger.log(
      `Frais de la fenêtre : ${assigned} attribué(s) sur ${+expected.toFixed(2)} attendu(s) ` +
        `(${feeByFill.size} fills, ${consumed} consommés).`,
    );
    return +expected.toFixed(2);
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

  /** Isolé pour que les tests n'attendent pas réellement. */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
