import type { PushAlertType } from '@prisma/client';
import { DEFAULT_MUTED_PUSH_TYPES } from '@mtc/shared';
import { isPremiumAccess } from '../../discord/discord-access.util';
import { inQuietHours } from '../../push/quiet-hours';
import { tradingDayEnd } from '../../session/active-session';

/**
 * Veille serveur (#770) : le WebSocket Tradovate reste ouvert après la fermeture du dernier onglet,
 * pour que les alertes en direct (règles prop firm, anti-tilt, comportement) partent en push app
 * fermée. Fonctions PURES : fin de veille et verdict d'éligibilité, à partir des lignes lues.
 */

/** Durée max d'une veille, bornée aussi par la fin de la journée de trading. */
export const WATCH_MAX_MS = 10 * 3600 * 1000;
/** Balayage du registre : fin de veille, reprise après la perte d'un process. */
export const WATCH_SWEEP_MS = 30_000;
/** Types d'alerte nés du direct : la veille ne sert que si l'un d'eux peut partir. */
export const WATCH_PUSH_TYPES: readonly PushAlertType[] = ['PROP_RULES', 'BEHAVIOR'];

/**
 * - `watch`  : WebSocket ouvert ;
 * - `paused` : heures silencieuses, rien ne partirait (même une limite franchie) : WebSocket fermé,
 *              veille gardée et rouverte à la fin de la plage ;
 * - `stop`   : veille terminée.
 */
export type WatchVerdict = 'watch' | 'paused' | 'stop';

/** Ce qu'il faut savoir d'un user pour juger sa veille (une lecture groupée par balayage). */
export interface WatchCandidate {
  isDemo: boolean;
  plan: string;
  role: string;
  trialEndsAt: Date | null;
  devices: number;
  /** Connexions Tradovate suivables (connectées, compte externe choisi). */
  connections: number;
  hasActiveSession: boolean;
  /** `null` : aucun réglage enregistré (types coupés par défaut, pas d'heures silencieuses). */
  preference: { mutedTypes: PushAlertType[]; quietStart: number | null; quietEnd: number | null } | null;
}

/** Fin de la veille commencée à `start` (ms epoch) : 10 h au plus, jamais après la journée de trading. */
export function watchEnd(start: Date): number {
  return Math.min(start.getTime() + WATCH_MAX_MS, tradingDayEnd(start).getTime());
}

export function watchVerdict(c: WatchCandidate | undefined, now: Date): WatchVerdict {
  if (!c || c.isDemo || !isPremiumAccess(c)) return 'stop';
  if (c.devices === 0 || c.connections === 0 || !c.hasActiveSession) return 'stop';
  const muted = c.preference?.mutedTypes ?? DEFAULT_MUTED_PUSH_TYPES;
  if (WATCH_PUSH_TYPES.every((t) => muted.includes(t))) return 'stop';
  if (inQuietHours(now, c.preference?.quietStart, c.preference?.quietEnd)) return 'paused';
  return 'watch';
}
