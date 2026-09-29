import { InjectionToken } from '@angular/core';

/**
 * Ce qui affiche un message d'erreur à l'utilisateur. Volontairement réduit à une méthode : chaque
 * app branche son propre système (le `ToastService` de l'app aujourd'hui, le composant partagé de
 * UI-11 demain) sans que l'intercepteur dépende d'une implémentation.
 *
 * Non fourni = aucune notification. L'admin n'a pas encore de toast : il ne doit pas planter pour
 * autant, l'intercepteur se contente alors de laisser passer l'erreur.
 */
export interface ErrorNotifier {
  error(message: string): unknown;
}

export const ERROR_NOTIFIER = new InjectionToken<ErrorNotifier>('ERROR_NOTIFIER');
