import { Injectable, signal } from '@angular/core';
import { demoOriginFromSearch, demoRegisterParams, type DemoOrigin } from '@mtc/shared';

/** Origine de la visite de la démo (UTM, parrain), gardée pour l'onglet (#1029). */
export const DEMO_ORIGIN_KEY = 'mtc_demo_origin';

/**
 * État du mode démo côté front. Quand un visiteur démo tente une action bloquée
 * (le backend renvoie 403 « mode démo »), on lève `showSignupPrompt` → une invite
 * de conversion « Crée ton compte » s'affiche dans le shell.
 * Garde aussi l'origine de la visite (`/demo?utm_*&ref=`) pour le lien d'inscription.
 */
@Injectable({ providedIn: 'root' })
export class DemoService {
  readonly showSignupPrompt = signal(false);
  /** Repli quand sessionStorage est indisponible. */
  private memory: DemoOrigin | null = null;

  promptSignup(): void {
    this.showSignupPrompt.set(true);
  }

  dismiss(): void {
    this.showSignupPrompt.set(false);
  }

  /**
   * Arrivée sur /demo : retient les UTM et le parrain de l'URL. Une URL sans paramètre garde
   * l'origine déjà retenue (rechargement, retour sur /demo dans le même onglet).
   */
  captureOrigin(search: string): void {
    const origin = demoOriginFromSearch(search);
    if (!Object.keys(origin).length) return;
    this.memory = origin;
    try {
      sessionStorage.setItem(DEMO_ORIGIN_KEY, JSON.stringify(origin));
    } catch {
      /* stockage indisponible : l'origine reste en mémoire pour cet onglet */
    }
  }

  /** Lien d'inscription : origine de la visite + `source=demo` (`demoRegisterParams`). */
  registerUrl(): string {
    return `/register?${new URLSearchParams(demoRegisterParams(this.origin())).toString()}`;
  }

  private origin(): DemoOrigin {
    if (this.memory) return this.memory;
    try {
      return demoOriginFromSearch(
        new URLSearchParams(JSON.parse(sessionStorage.getItem(DEMO_ORIGIN_KEY) ?? '{}') as Record<string, string>).toString(),
      );
    } catch {
      return {};
    }
  }
}
