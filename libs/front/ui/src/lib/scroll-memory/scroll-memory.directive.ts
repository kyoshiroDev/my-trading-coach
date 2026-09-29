import { Directive, ElementRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';

/** Temps max pour retrouver la position : la page recharge ses données après la navigation. */
const RESTORE_TIMEOUT_MS = 1500;

/**
 * Mémoire de défilement pour un conteneur qui défile lui-même : le `<main>` de l'app, le
 * `.content` de l'admin. `withInMemoryScrolling` du routeur ne gère que la fenêtre.
 * - nouvelle page → retour en haut ;
 * - bouton « Précédent » du navigateur → même position qu'avant (ex. retour dans le journal).
 */
@Directive({ selector: '[mtcScrollMemory]' })
export class ScrollMemoryDirective {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** Position de défilement par identifiant de navigation. */
  private readonly positions = new Map<number, number>();
  private currentNavigationId = 0;
  private restoreFrom: number | null = null;

  constructor() {
    inject(Router)
      .events.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (event instanceof NavigationStart) {
          this.positions.set(this.currentNavigationId, this.el.scrollTop);
          this.restoreFrom = event.restoredState?.navigationId ?? null;
        } else if (event instanceof NavigationEnd) {
          this.currentNavigationId = event.id;
          const target = this.restoreFrom === null ? 0 : (this.positions.get(this.restoreFrom) ?? 0);
          this.scrollTo(target);
        }
      });
  }

  /** Réessaie à chaque image tant que le contenu n'est pas assez haut (données en chargement). */
  private scrollTo(top: number): void {
    const start = performance.now();
    const attempt = () => {
      this.el.scrollTop = top;
      const reached = Math.abs(this.el.scrollTop - top) < 2;
      if (!reached && performance.now() - start < RESTORE_TIMEOUT_MS) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  }
}
