import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { visibleInterval } from './visible-interval';

/** Document minimal dont on pilote `hidden` et l'événement `visibilitychange`. */
function fakeDoc() {
  const target = new EventTarget();
  const doc = Object.assign(target, { hidden: false }) as unknown as Document & { hidden: boolean };
  const setHidden = (h: boolean) => {
    (doc as { hidden: boolean }).hidden = h;
    target.dispatchEvent(new Event('visibilitychange'));
  };
  return { doc, setHidden };
}

describe('visibleInterval (SCA-B4-02)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('émet au rythme demandé tant que l’onglet est visible', () => {
    const { doc } = fakeDoc();
    const ticks: number[] = [];
    const sub = visibleInterval(1000, doc).subscribe((n) => ticks.push(n));
    vi.advanceTimersByTime(3000);
    expect(ticks).toEqual([0, 1, 2]);
    sub.unsubscribe();
  });

  it('aucun appel onglet caché', () => {
    const { doc, setHidden } = fakeDoc();
    const ticks: number[] = [];
    const sub = visibleInterval(1000, doc).subscribe((n) => ticks.push(n));
    setHidden(true);
    vi.advanceTimersByTime(60_000);
    expect(ticks).toEqual([]);
    sub.unsubscribe();
  });

  it('au retour : une émission immédiate si une période a été manquée, puis le rythme reprend', () => {
    const { doc, setHidden } = fakeDoc();
    const ticks: number[] = [];
    const sub = visibleInterval(1000, doc).subscribe((n) => ticks.push(n));
    setHidden(true);
    vi.advanceTimersByTime(5500);
    setHidden(false);
    expect(ticks).toEqual([0]); // un seul rattrapage, pas cinq
    vi.advanceTimersByTime(500);
    expect(ticks).toEqual([0, 1]);
    sub.unsubscribe();
  });

  it('retour rapide (moins d’une période) : pas d’émission en plus', () => {
    const { doc, setHidden } = fakeDoc();
    const ticks: number[] = [];
    const sub = visibleInterval(10_000, doc).subscribe((n) => ticks.push(n));
    setHidden(true);
    vi.advanceTimersByTime(2000);
    setHidden(false);
    expect(ticks).toEqual([]);
    sub.unsubscribe();
  });

  it('désabonnement : plus rien, écouteur retiré', () => {
    const { doc, setHidden } = fakeDoc();
    const spy = vi.fn();
    visibleInterval(1000, doc).subscribe(spy).unsubscribe();
    vi.advanceTimersByTime(5000);
    setHidden(true);
    setHidden(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
