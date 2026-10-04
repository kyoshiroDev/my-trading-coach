import { Injectable, Logger } from '@nestjs/common';
import { TradovateApiError } from './tradovate.errors';
import { fetchFollowingRedirect, reportingBase } from './tradovate-hosts';
import type { TradovateEnv } from './tradovate.types';

/**
 * Reporting API Tradovate — l'HISTORIQUE, que la Trade API ne donne pas (elle est limitée à la
 * séance en cours). Confirmée par le support NinjaTrader le 2026-09-23 : elle s'utilise avec
 * NOTRE jeton OAuth lecture seule, sans accès partenaire.
 *
 * LECTURE SEULE : ce client n'expose qu'un POST de demande de rapport. Aucune écriture.
 *
 * ⚠️ Rien n'est documenté publiquement : le schéma ci-dessous a été reconstitué en lisant les
 * messages d'erreur du serveur (2026-09-26, sondage sur comptes réels). Quatre pièges, chacun
 * silencieux ou trompeur si on se trompe :
 *   1. `timezone` est un NOMBRE ; une chaîne donne « Invalid JSON: illegal number ».
 *   2. les dates sont en `M/D/YYYY` ; l'ISO `2026-09-26` renvoie un HTTP 500.
 *   3. `params` est un TABLEAU de `{ name, value }`, pas un objet.
 *   4. `account` attend le NOM du compte (« APEX4280470000012 »), pas son id numérique —
 *      l'id donne « account is not found (ID:0) ».
 *
 * Et une règle de performance qui n'en est pas une : **toujours passer `account`**. Sans lui,
 * Position History met 43 s, Account Balance History 60 s et Cash History dépasse 120 s ; avec
 * lui, tout répond en 150 à 270 ms. Facteur 200.
 */
/**
 * Bases de REPLI : la source de vérité est `apiHosts.reportingLive` / `reportingDemo` de la
 * connexion (cf. tradovate-hosts.ts), propre à l'organisation pour demo.
 */
export const TRADOVATE_REPORT_BASE: Record<TradovateEnv, string> = {
  live: reportingBase('live'),
  demo: reportingBase('demo'),
};

/** Fenêtre maximale mesurée : 63 jours passent, 92 sont refusés (« Too long range »). */
export const REPORT_MAX_WINDOW_DAYS = 62;

const TIMEOUT_MS = 60_000;

/**
 * Rapports utilisés. Le serveur en expose 8 (`/reports/requestReportDefinitions`, relevé le
 * 2026-10-03) : Performance, Orders, Position History, Cash History, Order Details, Chat History,
 * Fills, Account Balance History. Noms exacts, sensibles à la casse et aux espaces.
 */
export type TradovateReportName = 'Performance' | 'Cash History' | 'Fills' | 'Orders' | 'Account Balance History';

export interface ReportWindow {
  /** Bornes INCLUSIVES de la fenêtre demandée. */
  from: Date;
  to: Date;
  /** Nom du compte chez Tradovate — jamais son id (cf. piège n°4). */
  accountName: string;
}

/** `M/D/YYYY` en UTC : le seul format que le serveur accepte (cf. piège n°2). */
export function toReportDate(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

@Injectable()
export class TradovateReportingClient {
  private readonly logger = new Logger(TradovateReportingClient.name);

  /**
   * Demande un rapport et renvoie son CSV brut. Appel SYNCHRONE : le corps porte directement
   * `{ data }`, il n'y a ni identifiant de tâche ni attente à gérer.
   *
   * Renvoie `''` quand le rapport est vide (le serveur répond `{"data":"\r\n"}`) : un compte sans
   * activité sur la fenêtre est un cas normal, pas une erreur.
   */
  async fetchCsv(
    env: TradovateEnv,
    accessToken: string,
    name: TradovateReportName,
    window: ReportWindow,
    apiHosts?: unknown,
  ): Promise<string> {
    const body = {
      name,
      representationType: 'csv',
      timezone: 0, // UTC, et un NOMBRE (cf. piège n°1)
      params: [
        { name: 'startDate', value: toReportDate(window.from) },
        { name: 'endDate', value: toReportDate(window.to) },
        { name: 'account', value: window.accountName },
      ],
    };

    let res: Response;
    const started = Date.now();
    try {
      res = await fetchFollowingRedirect(
        `${reportingBase(env, apiHosts)}/v1/reports/requestReport`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
        (from, to) => this.logger.warn(`Rapport ${name} : redirection ${from} → ${to} (apiHosts périmé ?)`),
      );
    } catch (err) {
      throw new TradovateApiError('unavailable', 0, `rapport ${name} : ${(err as Error).name}`);
    }

    const text = await res.text();
    if (res.status === 401) throw new TradovateApiError('unauthorized', 401, `rapport ${name}`);
    if (res.status === 429) throw new TradovateApiError('rate_limited', 429, `rapport ${name}`);
    if (!res.ok) throw new TradovateApiError('unavailable', res.status, `rapport ${name}`);

    let parsed: { data?: string; errorText?: string } | null = null;
    try {
      parsed = JSON.parse(text) as { data?: string; errorText?: string };
    } catch {
      throw new TradovateApiError('unavailable', res.status, `rapport ${name} : réponse illisible`);
    }

    // Le serveur répond 200 avec un `errorText` : fenêtre trop large, compte inconnu…
    if (parsed?.errorText) {
      throw new TradovateApiError('unavailable', res.status, `rapport ${name} : ${parsed.errorText}`);
    }

    const csv = (parsed?.data ?? '').trim();
    this.logger.log(
      `Rapport ${name} ${toReportDate(window.from)}→${toReportDate(window.to)} ` +
        `(${window.accountName}) : ${csv ? csv.split(/\r?\n/).length - 1 : 0} ligne(s) en ${Date.now() - started} ms.`,
    );
    return csv;
  }
}
