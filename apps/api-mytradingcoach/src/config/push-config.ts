import { isVapidKey } from './env';

/** Clés VAPID du Web Push (notifications business de l'admin). */
export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export type PushConfigResult =
  | { enabled: true; config: PushConfig }
  | { enabled: false; reason: string };

/**
 * Lit la configuration du push. Jamais d'exception : une config absente ou invalide désactive
 * le push (l'API démarre quand même), la raison est journalisée au démarrage par AdminPushService.
 */
export function resolvePushConfig(env: NodeJS.ProcessEnv): PushConfigResult {
  if (env['PUSH_ENABLED'] !== 'true') return { enabled: false, reason: 'PUSH_ENABLED ≠ true' };
  const publicKey = env['VAPID_PUBLIC_KEY'] ?? '';
  const privateKey = env['VAPID_PRIVATE_KEY'] ?? '';
  const subject = env['VAPID_SUBJECT'] ?? '';
  const missing = [
    !isVapidKey(publicKey, 65) && 'VAPID_PUBLIC_KEY',
    !isVapidKey(privateKey, 32) && 'VAPID_PRIVATE_KEY',
    !/^(mailto:[^@\s]+@[^@\s]+|https:\/\/\S+)$/.test(subject) && 'VAPID_SUBJECT',
  ].filter((m): m is string => typeof m === 'string');
  if (missing.length > 0) return { enabled: false, reason: `invalide ou absente : ${missing.join(', ')}` };
  return { enabled: true, config: { publicKey, privateKey, subject } };
}
