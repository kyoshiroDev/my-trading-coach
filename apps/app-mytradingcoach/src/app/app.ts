import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
} from '@angular/core';
import {
  Router,
  NavigationEnd,
  ActivatedRoute,
  RouterModule,
} from '@angular/router';
import { filter, map } from 'rxjs/operators';
import { SeoService } from './core/seo/seo.service';
import { ProductEventsService } from './core/services/product-events.service';
import { ConfirmDialogComponent } from '@mtc/front-ui';
import { ToastsComponent } from './shared/components/toasts/toasts.component';

@Component({
  imports: [RouterModule, ToastsComponent, ConfirmDialogComponent],
  selector: 'mtc-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Toasts et dialogue de confirmation montés UNE fois, hors du routeur : ils survivent aux navigations.
  template: `<router-outlet /><mtc-toasts /><mtc-confirm-dialog />`,
})
export class App implements OnInit {
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly seo = inject(SeoService);
  private readonly events = inject(ProductEventsService);

  ngOnInit(): void {
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
}
