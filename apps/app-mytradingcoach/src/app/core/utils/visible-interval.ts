import { Observable } from 'rxjs';

/**
 * Comme `interval(ms)`, mais **muet quand l'onglet est caché** (SCA-B4-02) : un onglet oublié ne
 * sollicite plus l'API. Au retour sur l'onglet, émet **une fois tout de suite** si au moins `ms`
 * se sont écoulées depuis la dernière émission (rattrapage), puis reprend le rythme normal.
 * Tous les pollings du front passent par ici.
 */
export function visibleInterval(ms: number, doc: Document = document): Observable<number> {
  return new Observable<number>((sub) => {
    let count = 0;
    let last = Date.now();
    const emit = () => {
      last = Date.now();
      sub.next(count++);
    };
    const timer = setInterval(() => {
      if (!doc.hidden) emit();
    }, ms);
    const onVisibility = () => {
      if (!doc.hidden && Date.now() - last >= ms) emit();
    };
    doc.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      doc.removeEventListener('visibilitychange', onVisibility);
    };
  });
}
