import { WebPushError, sendNotification } from 'web-push';
import type { PushConfig } from '../../config/push-config';

export const PUSH_SENDER = Symbol('PUSH_SENDER');

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

/** Implémentation réelle : bibliothèque web-push (chiffrement aes128gcm + VAPID). Reprise de xmr-trader. */
export class WebPushLibSender implements PushSender {
  constructor(private readonly vapid: PushConfig) {}

  async send(target: PushTarget, payload: string, options: PushSendOptions): Promise<number> {
    try {
      const res = await sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        payload,
        {
          vapidDetails: {
            subject: this.vapid.subject,
            publicKey: this.vapid.publicKey,
            privateKey: this.vapid.privateKey,
          },
          TTL: options.ttlSeconds,
          urgency: options.urgency,
          timeout: 10_000,
          contentEncoding: 'aes128gcm',
        },
      );
      return res.statusCode;
    } catch (e) {
      // Réponse HTTP d'erreur du service push : on renvoie son code (404/410 = abonnement mort).
      if (e instanceof WebPushError) return e.statusCode;
      throw e;
    }
  }
}
