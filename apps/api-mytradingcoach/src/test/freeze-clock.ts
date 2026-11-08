import { afterEach, beforeEach, vi } from 'vitest';

/**
 * Fige l'horloge (`Date` seulement : les délais restent réels) sur `at` pour chaque test du bloc
 * courant, puis la remet en état. À appeler dans tout test qui fixe une date en dur : le code testé
 * lit souvent l'heure réelle (`new Date()`, paramètre `now` par défaut), et le test casserait le jour
 * où la date du jour dépasse un délai (essai, 48 h, 90 jours…). Vérification :
 * `TEST_NOW=<date ISO> pnpm exec vitest run --config vitest.clock.config.mts`.
 */
export function freezeClock(at: Date | string): void {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at);
  });
  afterEach(() => vi.useRealTimers());
}
