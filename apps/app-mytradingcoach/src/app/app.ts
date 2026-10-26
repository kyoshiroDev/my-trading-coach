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
import { ConfirmService } from '@mtc/front-ui';
// Chemin direct, pas le barrel : un composant importé par `@mtc/front-ui` resterait dans le bundle
// initial, même derrière `@defer`.
import { ConfirmDialogComponent } from '@mtc/front-ui/confirm-dialog';
import { ToastsComponent } from './shared/components/toasts/toasts.component';
import { InternalBadgeComponent } from './shared/components/internal-badge/internal-badge.component';
import { SignupFunnelService } from './core/services/signup-funnel.service';
import { InstallCapture } from './core/install/install-capture';
import { PUSH_BROWSER } from './core/push/push-browser';
import { AuthService } from './core/auth/auth.service';
import { InstallSheetComponent } from './features/install/install-sheet.component';

@Component({
  imports: [RouterModule, ToastsComponent, ConfirmDialogComponent, InternalBadgeComponent, InstallSheetComponent],
  selector: 'mtc-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Toasts et dialogue de confirmation montés UNE fois, hors du routeur : ils survivent aux navigations.
  // Dialogue de confirmation et feuille d'installation : chargés à la demande (`@defer`, budget du
  // bundle), à leur première ouverture. Le dialogue reste ensuite monté.
  template: `<router-outlet /><mtc-toasts /><mtc-internal-badge />
    @defer (when confirm.pending()) {
      <mtc-confirm-dialog />
    }
    @if (install.sheet()) {
      @defer (on immediate) {
        <mtc-install-sheet />
      }
    }`,
})
export class App implements OnInit {
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly seo = inject(SeoService);
  private readonly events = inject(ProductEventsService);
  private readonly injector = inject(Injector);
  /** Créé au démarrage : il garde `beforeinstallprompt`, envoyé tôt par Chrome (le parcours, lui, est paresseux). */
  protected readonly install = inject(InstallCapture);
  /** Lu par le `@defer` du dialogue : la première demande de confirmation le charge. */
  protected readonly confirm = inject(ConfirmService);
  private readonly browser = inject(PUSH_BROWSER);
  private readonly auth = inject(AuthService);
  private installLoaded = false;

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
        // Lancée depuis l'écran d'accueil, connecté : le parcours (paresseux) compte l'installation
        // et peut inviter aux alertes. Il suit ensuite lui-même les navigations.
        if (!this.installLoaded && this.auth.currentUser() && this.browser.env().standalone) {
          this.installLoaded = true;
          void this.install.load();
        }
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
