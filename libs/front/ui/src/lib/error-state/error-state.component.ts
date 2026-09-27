import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Message d'erreur de chargement, avec bouton « Réessayer ».
 * À afficher quand une donnée n'a pas pu être chargée : sans lui, une panne de l'API
 * ressemble à « aucune donnée » (zéros, écrans vides).
 *
 *   @if (loadError()) { <mtc-error-state (retry)="reload()" /> }
 */
@Component({
  selector: 'mtc-error-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './error-state.component.css',
  template: `
    <div class="es" role="alert" data-testid="error-state">
      <p class="es-text">{{ message() }}</p>
      <button type="button" class="es-retry" (click)="retry.emit()" data-testid="error-state-retry">
        Réessayer
      </button>
    </div>
  `,
})
export class ErrorStateComponent {
  readonly message = input('Les données n’ont pas pu être chargées. Vérifie ta connexion puis réessaie.');
  readonly retry = output<void>();
}
