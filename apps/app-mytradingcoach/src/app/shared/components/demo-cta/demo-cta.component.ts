import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { PREMIUM_SIGNUP_TRIAL_DAYS, type DemoCtaPlacement } from '@mtc/shared';
import { DialogDirective } from '@mtc/front-ui';
import { AuthService } from '@app/core/auth/auth.service';
import { DemoService } from '@app/core/services/demo.service';
import { ProductEventsService } from '@app/core/services/product-events.service';
import { DEMO_CTA_KEYS, DEMO_RELANCE_SCROLL_QUIET_MS, isTypingTarget, relanceDue } from './demo-cta.util';

/**
 * Bandeau d'inscription de la démo (#1029), fixé en bas de la zone de contenu sur toutes les pages
 * de la démo : « Créer mon compte » vers /register (origine de la visite + `source=demo`). La croix
 * le réduit en pastille jusqu'à la page suivante. Relance unique (60 s ou 3 pages, une fois par
 * visite, jamais pendant un défilement ou une saisie). Événements `demo_cta_view` (une fois par
 * visite), `demo_cta_click` (placement), `demo_modal_shown`, sans donnée personnelle.
 * Monté par le shell seulement en démo (`userStore.isDemo()`).
 */
@Component({
  selector: 'mtc-demo-cta',
  imports: [DialogDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './demo-cta.component.html',
  styleUrl: './demo-cta.component.css',
})
export class DemoCtaComponent {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly events = inject(ProductEventsService);
  protected readonly demo = inject(DemoService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  /** Repli quand sessionStorage est indisponible. */
  private readonly memory = new Map<string, string>();

  protected readonly trialDays = PREMIUM_SIGNUP_TRIAL_DAYS;
  protected readonly registerUrl = this.demo.registerUrl();
  protected readonly collapsed = signal(false);
  protected readonly relanceOpen = signal(false);

  private readonly continueBtn = viewChild<ElementRef<HTMLButtonElement>>('continueBtn');
  private lastScrollAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (!this.read(DEMO_CTA_KEYS.start)) this.write(DEMO_CTA_KEYS.start, String(Date.now()));
    // La page où le bandeau apparaît compte comme la 1re page vue (une seule fois, même si la fin
    // de la navigation en cours arrive juste après).
    // Né PENDANT une navigation (cas courant : /demo → /dashboard), `router.url` est encore
    // l'ancienne URL : c'est la fin de cette navigation qui compte la page.
    if (!untracked(this.router.currentNavigation)) this.countPage(this.router.url);
    if (!this.read(DEMO_CTA_KEYS.viewSent)) {
      this.write(DEMO_CTA_KEYS.viewSent, '1');
      this.events.track('demo_cta_view', 'banner');
    }

    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef))
      .subscribe((e) => {
        this.collapsed.set(false);
        this.countPage(e.urlAfterRedirects);
        this.check();
      });

    // Défilement de n'importe quelle zone (le contenu défile dans `main`, pas dans le document).
    const onScroll = () => (this.lastScrollAt = Date.now());
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      this.stopTimer();
    });

    if (!this.read(DEMO_CTA_KEYS.relanceShown)) this.timer = setInterval(() => this.check(), 1_000);
  }

  protected collapse(): void {
    this.collapsed.set(true);
  }

  protected closeRelance(): void {
    this.relanceOpen.set(false);
  }

  /** Clic « Créer mon compte » : compté, session démo effacée, puis /register dans l'app. */
  protected go(event: MouseEvent, placement: DemoCtaPlacement): void {
    this.events.track('demo_cta_click', placement);
    // Ctrl / Cmd / clic milieu : le navigateur ouvre le lien dans un nouvel onglet, la démo reste.
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1) return;
    event.preventDefault();
    this.relanceOpen.set(false);
    this.demo.dismiss();
    this.auth.endDemoSession();
    void this.router.navigateByUrl(this.registerUrl);
  }

  private check(): void {
    if (this.read(DEMO_CTA_KEYS.relanceShown)) {
      this.stopTimer();
      return;
    }
    const due = relanceDue({
      elapsedMs: Date.now() - Number(this.read(DEMO_CTA_KEYS.start) ?? Date.now()),
      pages: this.pages(),
      alreadyShown: false,
      busy: Date.now() - this.lastScrollAt < DEMO_RELANCE_SCROLL_QUIET_MS || isTypingTarget(document.activeElement),
      otherModal: this.demo.showSignupPrompt() || document.querySelector('[aria-modal="true"]') !== null,
    });
    if (!due) return;
    this.write(DEMO_CTA_KEYS.relanceShown, '1');
    this.stopTimer();
    this.relanceOpen.set(true);
    this.events.track('demo_modal_shown');
    // Après le focus posé par mtcDialog (1er bouton) : « Continuer la démo » prend le focus.
    afterNextRender(() => this.continueBtn()?.nativeElement.focus(), { injector: this.injector });
  }

  /**
   * Page vue = URL différente de la dernière comptée (sans paramètres) : un rechargement ou la fin
   * de la navigation qui a créé le bandeau ne comptent pas deux fois.
   */
  private countPage(url: string): void {
    const path = url.split(/[?#]/)[0];
    if (!path || path === '/' || path === '/demo' || path === this.read(DEMO_CTA_KEYS.lastPage)) return;
    this.write(DEMO_CTA_KEYS.lastPage, path);
    this.write(DEMO_CTA_KEYS.pages, String(this.pages() + 1));
  }

  private pages(): number {
    return Number(this.read(DEMO_CTA_KEYS.pages)) || 0;
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private read(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return this.memory.get(key) ?? null;
    }
  }

  private write(key: string, value: string): void {
    this.memory.set(key, value);
    try {
      sessionStorage.setItem(key, value);
    } catch {
      /* stockage indisponible : l'état vaut pour cette page */
    }
  }

}
