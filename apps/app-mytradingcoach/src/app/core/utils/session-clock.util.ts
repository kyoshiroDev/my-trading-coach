/** Au-delà, la session n'a pas été clôturée : un compteur à 265 h n'a plus de sens (#595). */
export const SESSION_STALE_MS = 24 * 3600 * 1000;

export type SessionClock =
  | { kind: 'timer'; label: string }
  /** Session ouverte depuis plus de 24 h : « Session ouverte depuis le JJ/MM, clôture-la ». */
  | { kind: 'stale'; since: string };

/** Chrono de la session active : `HH:MM:SS`, ou alerte si elle dure depuis plus de 24 h. */
export function sessionClock(startedAt: string, now: Date): SessionClock {
  const start = new Date(startedAt);
  const ms = Math.max(0, now.getTime() - start.getTime());
  if (ms > SESSION_STALE_MS) {
    return { kind: 'stale', since: start.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) };
  }
  const diff = Math.floor(ms / 1000);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return { kind: 'timer', label: `${pad(Math.floor(diff / 3600))}:${pad(Math.floor((diff % 3600) / 60))}:${pad(diff % 60)}` };
}
