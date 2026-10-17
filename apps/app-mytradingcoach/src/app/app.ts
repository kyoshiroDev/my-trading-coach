import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  inject,
  Injector,
  OnInit,
} from '@angular/core';
import {
  Router,
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  ActivatedRoute,
  RouterModule,
} from '@angular/router';
import { filter, first, map } from 'rxjs/operators';
import { SeoService } from './core/seo/seo.service';
import { ProductEventsService } from './core/services/product-events.service';
import { OfferIntentService } from './core/services/offer-intent.service';
import { ConfirmDialogComponent } from '@mtc/front-ui';
import { ToastsComponent } from './shared/components/toasts/toasts.component';
import { InternalBadgeComponent } from './shared/components/internal-badge/internal-badge.component';
import { SignupFunnelService } from './core/services/signup-funnel.service';

@Component({
  imports: [RouterModule, ToastsComponent, ConfirmDialogComponent, InternalBadgeComponent],
  selector: 'mtc-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Toasts et dialogue de confirmation montés UNE fois, hors du routeur : ils survivent aux navigations.
  template: `<router-outlet /><mtc-toasts /><mtc-confirm-dialog /><mtc-internal-badge />`,
})
export class App implements OnInit {
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly seo = inject(SeoService);
  private readonly events = inject(ProductEventsService);
  private readonly injector = inject(Injector);

  constructor() {
    // Offre visée par le lien d'arrivée (#525 : plan=founder, promo=CODE, cta) : capturée AVANT
    // toute redirection du routeur, puis proposée dans la modale une fois connecté.
    inject(OfferIntentService).capture();
    // Mode interne (?internal=1|0) : décidé avant toute étape du parcours d'inscription.
    inject(SignupFunnelService).captureInternal();
  }

  ngOnInit(): void {
    this.removeBootScreen();
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        map(() => {
          let route = this.activatedRoute;
          while (route.firstChild) route = route.firstChild;
          return route;
        }),
        filter((route) => route.outlet === 'primary'),
      )
      .subscribe((route) => {
        const seoConfig = route.snapshot.data?.['seo'];
        this.seo.apply(seoConfig ?? { noindex: true });
        // Entonnoir : retour de Stripe (success_url / cancel_url de l'API).
        const checkout = route.snapshot.queryParamMap.get('checkout');
        if (checkout === 'success' || checkout === 'canceled') this.events.once('checkout_return', checkout);
      });
  }

  /**
   * Écran de chargement statique de `index.html` (#mtc-boot) : retiré une fois la PREMIÈRE page
   * affichée, pas au démarrage d'Angular, sinon une page chargée à la demande laisserait un écran
   * vide le temps de son téléchargement.
   */
  private removeBootScreen(): void {
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd || e instanceof NavigationCancel || e instanceof NavigationError),
        first(),
      )
      .subscribe(() =>
        afterNextRender(() => document.getElementById('mtc-boot')?.remove(), { injector: this.injector }),
      );
  }
}
