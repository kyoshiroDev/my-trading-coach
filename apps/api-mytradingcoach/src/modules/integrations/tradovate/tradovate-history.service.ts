import { Injectable, Logger } from '@nestjs/common';
import { BrokerConnection, Prisma, TradeSource } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
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
 * Profondeur de l'import : **toute la vie du compte**, jusqu'à sa création.
 *
 * Tradovate date le compte (`timestamp` sur `/account/list`, appel que l'import fait déjà pour
 * relire le nom — donc zéro requête de plus). On remonte jusqu'à ce mois-là au lieu de deviner
 * une profondeur : un compte ouvert il y a trois mois coûte trois fenêtres, un compte de deux ans
 * les remonte toutes. Un mois vide ne coûte qu'un seul appel (pas de rapport `Fills`), remonter
 * loin est donc bon marché.
 *
 * Garde-fou, pas une politique : borne le nombre de fenêtres si la date de création est aberrante
 * ou le compte très ancien. La vraie borne, c'est la création.
 */
export const HISTORY_MAX_MONTHS = 60;
/** Profondeur retenue quand Tradovate ne date pas le compte (champ absent, compte archivé). */
export const HISTORY_FALLBACK_MONTHS = 6;
/**
 * Deux mois vides d'affilée = on s'arrête — **uniquement** faute de date de création, où la fin
 * apparente de l'historique est la seule borne disponible.
 *
 * Avec une date, cet arrêt est désactivé, et ce n'est pas un détail : mesuré le 2026-09-26 sur un
 * compte prop firm, création le 2026-02-12 et premier trade en juillet, soit **cinq mois vides
 * entre les deux**. L'arrêt aurait tronqué l'historique à mai en annonçant l'avoir tout remonté.
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
 * Import de l'HISTORIQUE d'un compte Tradovate via la Reporting API.
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
    private readonly prisma: PrismaService,
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
    const account = await this.resolveAccount(env, token, conn);
    const accountName = account.name;

    /**
     * Une profondeur demandée est TOUJOURS respectée, même sur une connexion qui n'a jamais eu son
     * import complet. Surtout ne pas la détourner « pour bien faire » : l'appelant qui ne demande
     * qu'un mois est souvent le bouton « Synchroniser », donc quelqu'un qui attend devant son
     * écran. Remonter deux ans de rapports à sa place transformerait un clic de 2 s en 30 s.
     *
     * L'import complet est déclenché ailleurs, là où personne n'attend : à la connexion du compte
     * (non attendu, cf. `tradovate.controller`) et par le cron de fond, qui rattrape les
     * connexions dont `historyImportedAt` est resté vide.
     */
    const { months, stopOnEmpty } =
      options.months !== undefined
        ? { months: Math.max(1, options.months), stopOnEmpty: true }
        : this.depthFromCreation(account, new Date());
    const result: HistoryImportResult = {
      created: 0, duplicates: 0, failed: 0, windows: 0, empty: 0, feesAssigned: 0, feesExpected: 0,
    };
    // Setup « Sans setup » : créé une fois pour tout l'import, comme le fait l'import CSV.
    const setupId = await this.setups.getImportSetupId(userId);
    let consecutiveEmpty = 0;

    for (const window of this.monthlyWindows(months, accountName)) {
      if (stopOnEmpty && consecutiveEmpty >= EMPTY_WINDOWS_BEFORE_STOP) break;
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

    const data: Prisma.BrokerConnectionUpdateInput = {};
    // Compteur de la connexion : l'import historique compte autant que la synchro live, sinon
    // l'écran Mes comptes affiche « 0 trade importé » sur une connexion qui vient d'en ramener
    // des centaines (constaté en beta : 294 trades, compteur à 0).
    if (result.created > 0) data.tradesImported = { increment: result.created };
    // Marqueur du passé complet : posé seulement par un import de profondeur pleine, et seulement
    // si TOUTES les fenêtres ont abouti — une seule en échec laisse un trou dans l'histoire du
    // compte, et le cron doit garder le droit de le combler.
    if (options.months === undefined && result.failed === 0) data.historyImportedAt = new Date();
    if (Object.keys(data).length > 0) {
      await this.prisma.brokerConnection.update({ where: { id: conn.id }, data });
    }

    const profondeur = stopOnEmpty
      ? `${months} mois`
      : `${months} mois, depuis la création du compte (${account.timestamp?.slice(0, 10)})`;
    this.logger.log(
      `Import historique Tradovate (compte ${accountName}, ${profondeur}) : ${result.created} créé(s), ` +
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

    const { broker, csv } = preprocessCsv(this.horodatagesEnUtc(performance));
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

  /**
   * Réécrit `boughtTimestamp` / `soldTimestamp` en ISO UTC (`…Z`) AVANT de passer au parseur.
   *
   * Sans ça, les trades importés sont décalés de l'offset du serveur (mesuré en prod : 2 h
   * d'avance, conteneur en Europe/Paris). Le parseur partagé fait `new Date("07/27/2026
   * 14:26:44")` : sans fuseau dans la chaîne, Node l'interprète en heure LOCALE. C'est une
   * approximation acceptable pour l'import CSV manuel — l'export de l'interface Tradovate est
   * rendu dans l'heure de l'utilisateur — mais pas ici : nous demandons explicitement le rapport
   * en UTC (`timezone: 0`), donc ses heures SONT de l'UTC et doivent être lues comme telles.
   *
   * Corrigé ici plutôt que dans le parseur, pour ne rien changer au chemin d'import manuel.
   */
  private horodatagesEnUtc(csv: string): string {
    const lignes = csv.split(/\r?\n/);
    if (lignes.length < 2) return csv;
    const entete = lignes[0].split(',').map((h) => h.trim().toLowerCase());
    const colonnes = ['boughttimestamp', 'soldtimestamp']
      .map((n) => entete.indexOf(n))
      .filter((i) => i >= 0);
    if (colonnes.length === 0) return csv;

    const enIso = (v: string): string => {
      // `MM/DD/YYYY HH:MM:SS` → `YYYY-MM-DDTHH:MM:SSZ`
      const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})\s*$/.exec(v);
      if (!m) return v;
      const [, mois, jour, annee, heure] = m;
      return `${annee}-${mois.padStart(2, '0')}-${jour.padStart(2, '0')}T${heure}Z`;
    };

    return lignes
      .map((ligne, i) => {
        if (i === 0 || !ligne.trim()) return ligne;
        const cols = ligne.split(',');
        for (const c of colonnes) if (cols[c] != null) cols[c] = enIso(cols[c]);
        return cols.join(',');
      })
      .join('\n');
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
  private async resolveAccount(
    env: TradovateEnv,
    token: string,
    conn: BrokerConnection,
  ): Promise<TradovateAccount> {
    const accounts = await this.api.get<TradovateAccount[]>(env, '/account/list', token);
    const account = (Array.isArray(accounts) ? accounts : []).find(
      (a) => String(a.id) === conn.externalAccountId,
    );
    if (!account) throw new TradovateException('TRADOVATE_ACCOUNT_NOT_FOUND');
    return account;
  }

  /**
   * Combien de fenêtres mensuelles pour couvrir toute la vie du compte, mois de création inclus.
   *
   * Sans date exploitable (champ absent, ou postérieure à maintenant — donnée à ne pas croire),
   * on retombe sur une profondeur fixe ET sur l'arrêt aux mois vides : c'est alors la seule façon
   * de savoir qu'on a dépassé le début du compte.
   */
  private depthFromCreation(
    account: TradovateAccount,
    now: Date,
  ): { months: number; stopOnEmpty: boolean } {
    const created = account.timestamp ? new Date(account.timestamp) : null;
    if (!created || Number.isNaN(created.getTime()) || created.getTime() > now.getTime()) {
      return { months: HISTORY_FALLBACK_MONTHS, stopOnEmpty: true };
    }
    const months =
      (now.getUTCFullYear() - created.getUTCFullYear()) * 12 +
      (now.getUTCMonth() - created.getUTCMonth()) +
      1;
    return { months: Math.min(Math.max(1, months), HISTORY_MAX_MONTHS), stopOnEmpty: false };
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
