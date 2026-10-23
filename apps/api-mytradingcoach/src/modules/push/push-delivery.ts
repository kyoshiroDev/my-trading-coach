import type { Logger } from '@nestjs/common';
import type { PushSendOptions, PushSender, PushTarget } from './push-sender';

/** Bilan d'un envoi (même forme que `AdminPushTestResult`). */
export interface PushDeliveryReport {
  subscriptions: number;
  delivered: number;
  failed: number;
  removed: number;
}

export interface PushDeliveryTarget extends PushTarget {
  id: string;
}

/** Écritures faites selon la réponse du service push. Best-effort : leurs erreurs sont ignorées. */
export interface PushDeliveryStore {
  /** 2xx : appareil joignable (`lastSuccessAt`). */
  delivered(id: string): Promise<unknown>;
  /** 404 / 410 : abonnement mort, à supprimer. */
  gone(id: string): Promise<unknown>;
}

/** Hôte du service push : seul élément journalisé (l'endpoint complet contient un jeton). */
export function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return '?';
  }
}

/**
 * Envoie `payload` à chaque cible, en parallèle, commun à l'admin et aux traders.
 * 2xx → livré ; 404/410 → abonnement mort, supprimé ; autre code ou exception → échec journalisé.
 * Ne lève jamais.
 */
export async function deliverPush(
  sender: PushSender,
  targets: PushDeliveryTarget[],
  payload: string,
  options: PushSendOptions,
  store: PushDeliveryStore,
  logger: Pick<Logger, 'log' | 'warn'>,
  /** « admin » ou « trader » : seulement pour les journaux. */
  audience: string,
): Promise<PushDeliveryReport> {
  const report: PushDeliveryReport = { subscriptions: targets.length, delivered: 0, failed: 0, removed: 0 };
  await Promise.all(
    targets.map(async (t) => {
      try {
        const status = await sender.send(t, payload, options);
        if (status >= 200 && status < 300) {
          report.delivered++;
          await store.delivered(t.id).catch(() => undefined);
        } else if (status === 404 || status === 410) {
          report.removed++;
          await store.gone(t.id).catch(() => undefined);
          logger.log(`Abonnement push mort supprimé (${hostOf(t.endpoint)}, HTTP ${status})`);
        } else {
          report.failed++;
          logger.warn(`Push ${audience} refusé (${hostOf(t.endpoint)}, HTTP ${status})`);
        }
      } catch (err) {
        report.failed++;
        logger.warn(`Push ${audience} en échec (${hostOf(t.endpoint)}) : ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );
  return report;
}
