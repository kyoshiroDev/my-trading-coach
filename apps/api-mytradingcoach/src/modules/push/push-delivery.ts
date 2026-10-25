import type { Logger } from '@nestjs/common';
import type { PushSendOptions, PushSender, PushTarget } from './push-sender';
import { pushEndpointCheck } from './push-endpoint';
import { PushDeadlineError } from './push-http';

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

/** Classe de la réponse pour les journaux : 404 et 410 à part (abonnement mort), sinon `Nxx`. */
export function pushStatusClass(status: number): string {
  if (status === 404 || status === 410) return String(status);
  return `${Math.floor(status / 100)}xx`;
}

/**
 * Ligne journalisée pour UNE tentative d'envoi à un appareil : audience, type, résultat, classe de
 * code, hôte du service push. Jamais l'adresse d'abonnement, ses clés ni un identifiant.
 */
export function pushAttemptLine(audience: string, kind: string, delivered: boolean, outcome: string, host: string): string {
  return `Envoi push ${audience} ${kind} : ${delivered ? 'livré' : 'échec'} (${outcome}, ${host})`;
}

/**
 * Envoie `payload` à chaque cible, en parallèle, commun à l'admin et aux traders.
 * 2xx → livré ; 404/410 → abonnement mort, supprimé ; autre code ou exception → échec.
 * Une ligne de journal (info) par tentative, voir `pushAttemptLine`. Ne lève jamais.
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
  /** Type de notification (TEST, PROP_RULES, RECAP…) : seulement pour les journaux. */
  kind: string,
): Promise<PushDeliveryReport> {
  const report: PushDeliveryReport = { subscriptions: targets.length, delivered: 0, failed: 0, removed: 0 };
  await Promise.all(
    targets.map(async (t) => {
      // Ligne en base hors liste blanche (abonnée avant la liste, ou écrite à la main) : jamais
      // contactée, supprimée comme un abonnement mort.
      const check = pushEndpointCheck(t.endpoint);
      if (!check.ok) {
        report.removed++;
        await store.gone(t.id).catch(() => undefined);
        logger.warn(`Abonnement push ${audience} supprimé sans envoi : ${check.reason} (${check.host})`);
        return;
      }
      const host = hostOf(t.endpoint);
      try {
        const status = await sender.send(t, payload, options);
        const outcome = pushStatusClass(status);
        if (status >= 200 && status < 300) {
          report.delivered++;
          logger.log(pushAttemptLine(audience, kind, true, outcome, host));
          await store.delivered(t.id).catch(() => undefined);
        } else if (status === 404 || status === 410) {
          report.removed++;
          logger.log(`${pushAttemptLine(audience, kind, false, outcome, host)}, abonnement supprimé`);
          await store.gone(t.id).catch(() => undefined);
        } else {
          report.failed++;
          logger.log(pushAttemptLine(audience, kind, false, outcome, host));
        }
      } catch (err) {
        report.failed++;
        // Le message de l'erreur n'est pas repris : il pourrait citer l'adresse.
        logger.log(pushAttemptLine(audience, kind, false, err instanceof PushDeadlineError ? 'délai dépassé' : 'erreur réseau', host));
      }
    }),
  );
  return report;
}
