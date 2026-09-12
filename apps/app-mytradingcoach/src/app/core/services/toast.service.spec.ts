import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MAX_VISIBLE_TOASTS, TOAST_DURATIONS, ToastService } from './toast.service';

describe('ToastService — file, durées, pause (PROMPT-210)', () => {
  let toast: ToastService;

  beforeEach(() => {
    vi.useFakeTimers();
    toast = new ToastService();
  });
  afterEach(() => vi.useRealTimers());

  const messages = () => toast.visible().map((t) => t.message);

  it('4 types, chacun avec sa durée : court pour succès/info, long pour erreur/alerte', () => {
    toast.success('a'); toast.info('b'); toast.warning('c');
    expect(toast.visible().map((t) => [t.type, t.duration])).toEqual([
      ['success', TOAST_DURATIONS.success], ['info', TOAST_DURATIONS.info], ['warning', TOAST_DURATIONS.warning],
    ]);
    expect(TOAST_DURATIONS.success).toBeLessThanOrEqual(4000);
    expect(TOAST_DURATIONS.error).toBeGreaterThanOrEqual(6000);
    expect(TOAST_DURATIONS.warning).toBeGreaterThanOrEqual(6000);
  });

  it('succès : disparaît seul après sa durée', () => {
    toast.success('Trade enregistré');
    vi.advanceTimersByTime(TOAST_DURATIONS.success - 1);
    expect(messages()).toEqual(['Trade enregistré']);
    vi.advanceTimersByTime(1);
    expect(messages()).toEqual([]);
  });

  it('erreur : reste plus longtemps qu’un succès', () => {
    toast.error('Échec');
    vi.advanceTimersByTime(TOAST_DURATIONS.success + 100);
    expect(messages()).toEqual(['Échec']);
    vi.advanceTimersByTime(TOAST_DURATIONS.error);
    expect(messages()).toEqual([]);
  });

  it('au plus 3 visibles, les suivants attendent en file et prennent la place libérée', () => {
    ['1', '2', '3', '4', '5'].forEach((m) => toast.info(m));
    expect(MAX_VISIBLE_TOASTS).toBe(3);
    expect(messages()).toEqual(['1', '2', '3']);
    expect(toast.queued()).toBe(2);

    toast.dismiss(toast.visible()[0].id);
    expect(messages()).toEqual(['2', '3', '4']);
    expect(toast.queued()).toBe(1);
  });

  it('un toast en file ne s’expire pas sans avoir été vu', () => {
    ['1', '2', '3'].forEach((m) => toast.info(m, { duration: null }));
    toast.success('en file');
    vi.advanceTimersByTime(TOAST_DURATIONS.success * 3);
    expect(toast.queued()).toBe(1); // toujours là

    toast.dismiss(toast.visible()[0].id);
    expect(messages()).toContain('en file');
    vi.advanceTimersByTime(TOAST_DURATIONS.success);
    expect(messages()).not.toContain('en file');
  });

  it('survol : le temps est suspendu, puis reprend là où il en était', () => {
    const id = toast.success('lecture');
    vi.advanceTimersByTime(3000);
    toast.pause(id);
    vi.advanceTimersByTime(60_000);
    expect(messages()).toEqual(['lecture']);

    toast.resume(id);
    vi.advanceTimersByTime(TOAST_DURATIONS.success - 3000 - 1);
    expect(messages()).toEqual(['lecture']);
    vi.advanceTimersByTime(1);
    expect(messages()).toEqual([]);
  });

  it('duration: null → reste jusqu’à la croix', () => {
    const id = toast.error('Persistant le temps de lire', { duration: null });
    vi.advanceTimersByTime(10 * 60_000);
    expect(messages()).toEqual(['Persistant le temps de lire']);
    toast.dismiss(id);
    expect(messages()).toEqual([]);
  });

  it('même message répété (double-clic) : pas d’empilement, le toast est relancé', () => {
    toast.error('Échec réseau');
    vi.advanceTimersByTime(TOAST_DURATIONS.error - 1000);
    toast.error('Échec réseau');
    expect(toast.visible()).toHaveLength(1);
    vi.advanceTimersByTime(2000);
    expect(messages()).toEqual(['Échec réseau']); // relancé, pas expiré
  });

  it('état de pause exposé (lu par la barre de compte à rebours), nettoyé à la fermeture', () => {
    const id = toast.success('x');
    expect(toast.isPaused(id)).toBe(false);
    toast.pause(id);
    expect(toast.isPaused(id)).toBe(true);
    toast.resume(id);
    expect(toast.isPaused(id)).toBe(false);
    toast.pause(id);
    toast.dismiss(id);
    expect(toast.isPaused(id)).toBe(false);
  });

  it('relance d’un même message : version incrémentée (la barre repart de zéro)', () => {
    toast.error('Échec réseau');
    expect(toast.visible()[0].version).toBe(0);
    toast.error('Échec réseau');
    expect(toast.visible()[0].version).toBe(1);
  });

  it('clear() vide tout, minuteurs compris', () => {
    toast.success('a'); toast.error('b');
    toast.clear();
    expect(toast.visible()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
