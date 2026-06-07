import { Injectable, signal } from '@angular/core';

/**
 * État du mode démo côté front. Quand un visiteur démo tente une action bloquée
 * (le backend renvoie 403 « mode démo »), on lève `showSignupPrompt` → une invite
 * de conversion « Crée ton compte » s'affiche dans le shell.
 */
@Injectable({ providedIn: 'root' })
export class DemoService {
  readonly showSignupPrompt = signal(false);

  promptSignup(): void {
    this.showSignupPrompt.set(true);
  }

  dismiss(): void {
    this.showSignupPrompt.set(false);
  }
}
