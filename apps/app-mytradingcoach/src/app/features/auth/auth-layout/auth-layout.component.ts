import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ViewContainerRef,
  afterNextRender,
  inject,
  viewChild,
} from '@angular/core';

const WIDE_QUERY = '(min-width: 1024px)';

/**
 * Mise en page de `/register` et `/login` (maquette `maquette-register-split.html`) : sous 1024 px,
 * la carte du formulaire seule ; au-delà, la colonne de présentation à gauche et le formulaire à
 * droite. La page projette le contenu de la carte ; logo (mobile) et ligne de confiance sont communs.
 *
 * Chargée au démarrage avec l'inscription, à quelques Ko du budget bloquant du bundle initial :
 * aucune icône `@lucide/angular`, et la colonne de présentation importée à la demande, seulement
 * quand la fenêtre atteint 1024 px (jamais sur téléphone), depuis le morceau de la route /login
 * (cf. l'export en bas de `login.component.ts`). `import()` plutôt que `@defer`, qui ajoutait
 * ~2,7 Ko au bundle initial.
 */
@Component({
  selector: 'mtc-auth-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-layout.component.css',
  templateUrl: './auth-layout.component.html',
})
export class AuthLayoutComponent {
  private readonly pitch = viewChild.required('pitch', { read: ViewContainerRef });

  constructor() {
    if (typeof matchMedia === 'undefined') return;
    const query = matchMedia(WIDE_QUERY);
    const destroyRef = inject(DestroyRef);
    let loaded = false;
    const load = () => {
      if (loaded || !query.matches) return;
      loaded = true;
      void import('../login.component').then(({ AuthPitchComponent }) => {
        if (!destroyRef.destroyed) this.pitch().createComponent(AuthPitchComponent);
      });
    };
    // Tablette tournée en paysage, fenêtre agrandie : chargée au premier passage à 1024 px.
    query.addEventListener('change', load);
    destroyRef.onDestroy(() => query.removeEventListener('change', load));
    afterNextRender(load);
  }
}
