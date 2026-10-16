import { Observable, Subscription, take } from 'rxjs';

export type PollResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

export interface VisiblePollOptions {
  /** Rythme normal entre deux requêtes réussies. */
  periodMs: number;
  /** Plafond de l'espacement après des échecs successifs (défaut : 8 × periodMs). */
  maxDelayMs?: number;
  doc?: Document;
}

/**
 * Polling de l'admin : une requête tout de suite, puis toutes les `periodMs`.
 * - **Aucune requête onglet caché** : le prochain tick attend le retour sur l'onglet, puis part
 *   aussitôt.
 * - **Espacement après échec** : 2 ×, 4 ×, 8 × la période (plafonné), retour au rythme normal dès
 *   qu'une requête réussit. Un serveur injoignable n'est plus sollicité toutes les 15 s.
 * - Jamais deux requêtes en parallèle : le délai part de la fin de la précédente.
 * Les erreurs sont émises (`{ ok: false }`), elles ne terminent pas le flux.
 */
export function visiblePoll<T>(request: () => Observable<T>, opts: VisiblePollOptions): Observable<PollResult<T>> {
  const { periodMs, doc = document } = opts;
  const maxDelayMs = opts.maxDelayMs ?? periodMs * 8;

  return new Observable<PollResult<T>>((subscriber) => {
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inflight: Subscription | undefined;
    let waitingVisible = false;

    const schedule = () => {
      const delay = failures === 0 ? periodMs : Math.min(periodMs * 2 ** failures, maxDelayMs);
      timer = setTimeout(tick, delay);
    };

    const tick = () => {
      timer = undefined;
      if (doc.hidden) {
        waitingVisible = true;
        return;
      }
      inflight = request().pipe(take(1)).subscribe({
        next: (value) => {
          failures = 0;
          subscriber.next({ ok: true, value });
        },
        error: (error: unknown) => {
          failures++;
          subscriber.next({ ok: false, error });
          schedule();
        },
        // `error` ne passe pas par `complete` : un seul schedule() par requête.
        complete: () => schedule(),
      });
    };

    const onVisibility = () => {
      if (!doc.hidden && waitingVisible) {
        waitingVisible = false;
        tick();
      }
    };

    doc.addEventListener('visibilitychange', onVisibility);
    tick();
    return () => {
      clearTimeout(timer);
      inflight?.unsubscribe();
      doc.removeEventListener('visibilitychange', onVisibility);
    };
  });
}
