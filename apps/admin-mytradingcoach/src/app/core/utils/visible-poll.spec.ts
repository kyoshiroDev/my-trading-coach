import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { visiblePoll, type PollResult } from './visible-poll';

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

describe('visiblePoll', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('une requête tout de suite puis au rythme demandé', () => {
    const { doc } = fakeDoc();
    const request = vi.fn(() => of('ok'));
    const out: PollResult<string>[] = [];
    const sub = visiblePoll(request, { periodMs: 1000, doc }).subscribe((r) => out.push(r));
    expect(request).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(request).toHaveBeenCalledTimes(4);
    expect(out.every((r) => r.ok)).toBe(true);
    sub.unsubscribe();
  });

  it('aucune requête onglet caché, une tout de suite au retour', () => {
    const { doc, setHidden } = fakeDoc();
    const request = vi.fn(() => of('ok'));
    const sub = visiblePoll(request, { periodMs: 1000, doc }).subscribe();
    setHidden(true);
    vi.advanceTimersByTime(60_000);
    expect(request).toHaveBeenCalledTimes(1); // seulement l'appel initial, onglet encore visible
    setHidden(false);
    expect(request).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(request).toHaveBeenCalledTimes(3);
    sub.unsubscribe();
  });

  it('espacement après échec (×2, ×4, plafonné), rythme normal dès un succès', () => {
    const { doc } = fakeDoc();
    let fail = true;
    const request = vi.fn(() => (fail ? throwError(() => new Error('503')) : of('ok')));
    const out: PollResult<string>[] = [];
    const sub = visiblePoll(request, { periodMs: 1000, maxDelayMs: 4000, doc }).subscribe((r) => out.push(r));
    expect(out[0]).toMatchObject({ ok: false });

    vi.advanceTimersByTime(1999);
    expect(request).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1); // 2 s après le 1er échec
    expect(request).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(4000); // 4 s après le 2e
    expect(request).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(4000); // plafond 4 s
    expect(request).toHaveBeenCalledTimes(4);

    fail = false;
    vi.advanceTimersByTime(4000);
    expect(request).toHaveBeenCalledTimes(5);
    expect(out.at(-1)).toEqual({ ok: true, value: 'ok' });
    vi.advanceTimersByTime(1000);
    expect(request).toHaveBeenCalledTimes(6);
    sub.unsubscribe();
  });

  it('plus rien après désabonnement', () => {
    const { doc } = fakeDoc();
    const request = vi.fn(() => of('ok'));
    visiblePoll(request, { periodMs: 1000, doc }).subscribe().unsubscribe();
    vi.advanceTimersByTime(10_000);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
