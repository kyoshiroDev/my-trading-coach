import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Œil « afficher / masquer le mot de passe » (tracés Lucide `eye` / `eye-off`) en SVG en ligne :
 * l'inscription et la connexion sont chargées au démarrage, et importer `@lucide/angular` y
 * ajouterait tout le module d'icônes au chargement initial (cf. angular.md, bundle initial).
 */
@Component({
  selector: 'mtc-eye-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './eye-icon.component.css',
  template: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    @if (off()) {
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    } @else {
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    }
  </svg>`,
})
export class EyeIconComponent {
  /** Œil barré (mot de passe affiché, l'appui le masque). */
  readonly off = input(false);
}
