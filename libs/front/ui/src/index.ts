/**
 * `@mtc/front-ui` : briques d'interface partagées par l'app et l'admin (Angular).
 * Styles globaux : `src/styles/foundations.css`, importé par le styles.css de chaque app.
 * Le dialogue de confirmation n'est PAS exporté ici : `@mtc/front-ui/confirm-dialog`. Exporté par ce
 * barrel, il resterait dans le bundle initial de l'app même chargé par `@defer` (budget du bundle).
 */
export * from './lib/confirm-dialog/confirm.service';
export * from './lib/error-state/error-state.component';
export * from './lib/dialog/dialog.directive';
export * from './lib/scroll-memory/scroll-memory.directive';
export * from './lib/http/error.interceptor';
export * from './lib/http/error-notifier';
export * from './lib/http/silent-errors';
