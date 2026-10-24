import { generateRequestDetails } from 'web-push';
import type { PushConfig } from '../../config/push-config';
import { PUSH_DEADLINE_MS, PUSH_MAX_RESPONSE_BYTES, postWithLimits, type PushHttpLimits } from './push-http';
import { pushEndpointCheck } from './push-endpoint';

export const PUSH_SENDER = Symbol('PUSH_SENDER');
/** Résultat de `resolvePushConfig` (fourni par `PushCoreModule`). */
export const PUSH_CONFIG = Symbol('PUSH_CONFIG');

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSendOptions {
  ttlSeconds: number;
  urgency: 'high' | 'normal';
}

/** Envoi vers le service push du navigateur ; renvoie le code HTTP de sa réponse. */
export interface PushSender {
  send(target: PushTarget, payload: string, options: PushSendOptions): Promise<number>;
}

/**
 * Implémentation réelle : `web-push` chiffre (aes128gcm) et signe (VAPID) la requête, l'envoi HTTP
 * est le nôtre (`postWithLimits` : délai total, plafond de réponse, aucune redirection). L'adresse
 * est revérifiée contre la liste blanche juste avant l'envoi. Rend le code HTTP du service push.
 */
export class WebPushLibSender implements PushSender {
  constructor(
    private readonly vapid: PushConfig,
    private readonly limits: PushHttpLimits = { deadlineMs: PUSH_DEADLINE_MS, maxResponseBytes: PUSH_MAX_RESPONSE_BYTES },
    /** Tests seulement : faux serveur local, hors liste blanche. */
    private readonly checkEndpoint = (endpoint: string) => pushEndpointCheck(endpoint).ok,
  ) {}

  async send(target: PushTarget, payload: string, options: PushSendOptions): Promise<number> {
    if (!this.checkEndpoint(target.endpoint)) throw new Error('service push non autorisé');
    const details = generateRequestDetails(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      payload,
      {
        vapidDetails: { subject: this.vapid.subject, publicKey: this.vapid.publicKey, privateKey: this.vapid.privateKey },
        TTL: options.ttlSeconds,
        urgency: options.urgency,
        contentEncoding: 'aes128gcm',
      },
    );
    return postWithLimits(
      { endpoint: details.endpoint, method: details.method, headers: details.headers as Record<string, string | number>, body: details.body },
      this.limits,
    );
  }
}
