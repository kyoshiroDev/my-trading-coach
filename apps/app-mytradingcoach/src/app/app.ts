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

@Component({
  imports: [RouterModule],
  selector: 'mtc-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<router-outlet />`,
})
export class App implements OnInit {
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly seo = inject(SeoService);

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
      });
  }
}
