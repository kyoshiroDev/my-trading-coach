import { InjectionToken } from '@angular/core';

/**
 * Choix d'installation gardés SUR L'APPAREIL (décision du 2026-10-25 : aucune route API).
 * `localStorage` : « Plus tard » (date de fin du report), « Ne plus me proposer », installation
 * déjà comptée. `sessionStorage` : déjà proposée dans cette session. Stockage indisponible
 * (navigation privée, données bloquées) : tout est lu comme absent et rien ne casse.
 * Remplaçable dans les tests.
 */
export interface InstallStorage {
  laterUntil(sheet: 'install' | 'push'): number | null;
  setLaterUntil(sheet: 'install' | 'push', at: number): void;
  isNever(sheet: 'install' | 'push'): boolean;
  setNever(sheet: 'install' | 'push'): void;
  shownThisSession(sheet: 'install' | 'push'): boolean;
  markSession(sheet: 'install' | 'push'): void;
  isDone(): boolean;
  setDone(): void;
}

const key = (sheet: string, what: string) => `mtc_${sheet}_${what}`;

function read(store: () => Storage, k: string): string | null {
  try {
    return store().getItem(k);
  } catch {
    return null;
  }
}

function write(store: () => Storage, k: string, v: string): void {
  try {
    store().setItem(k, v);
  } catch {
    // Stockage plein ou bloqué : le choix vaut pour cette page seulement.
  }
}

const local = () => localStorage;
const session = () => sessionStorage;

export const INSTALL_STORAGE = new InjectionToken<InstallStorage>('INSTALL_STORAGE', {
  providedIn: 'root',
  factory: () => ({
    laterUntil: (sheet) => {
      const n = Number(read(local, key(sheet, 'later_until')));
      return Number.isFinite(n) && n > 0 ? n : null;
    },
    setLaterUntil: (sheet, at) => write(local, key(sheet, 'later_until'), String(at)),
    isNever: (sheet) => read(local, key(sheet, 'never')) === '1',
    setNever: (sheet) => write(local, key(sheet, 'never'), '1'),
    shownThisSession: (sheet) => read(session, key(sheet, 'shown')) === '1',
    markSession: (sheet) => write(session, key(sheet, 'shown'), '1'),
    isDone: () => read(local, 'mtc_install_done') === '1',
    setDone: () => write(local, 'mtc_install_done', '1'),
  }),
});
