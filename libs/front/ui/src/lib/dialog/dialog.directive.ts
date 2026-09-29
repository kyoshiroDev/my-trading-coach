import { Directive, ElementRef, EventEmitter, Output, afterNextRender, inject, type OnDestroy } from '@angular/core';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Rend une modale accessible au clavier et au lecteur d'écran. À poser sur la boîte
 * (pas sur le fond) :
 * `<div class="modal" role="dialog" aria-modal="true" mtcDialog (mtcDialogClose)="close()">`.
 *
 * - `role="dialog"` et `aria-modal="true"` sont posés par la directive ; on les répète dans le
 *   template pour que le lint Angular sache que l'élément est interactif. Le titre se relie avec
 *   `aria-labelledby` ;
 * - à l'ouverture, place le focus sur le premier élément focusable (ou sur la boîte) ;
 * - Tab et Maj+Tab restent dans la modale ;
 * - Échap émet `mtcDialogClose` (seule la modale du dessus réagit) ;
 * - à la fermeture, rend le focus à l'élément qui l'avait avant.
 */
@Directive({
  selector: '[mtcDialog]',
  host: {
    role: 'dialog',
    'aria-modal': 'true',
    tabindex: '-1',
    '(keydown)': 'onKeydown($event)',
  },
})
export class DialogDirective implements OnDestroy {
  /** Modales ouvertes, de la plus ancienne à la plus récente. */
  private static readonly stack: DialogDirective[] = [];

  // @Output() plutôt que output() : les tests de la lib tournent en JIT, qui ne voit pas output().
  @Output() readonly mtcDialogClose = new EventEmitter<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly returnFocusTo = document.activeElement as HTMLElement | null;

  constructor() {
    DialogDirective.stack.push(this);
    afterNextRender(() => {
      const first = this.focusables()[0];
      (first ?? this.host).focus();
    });
  }

  ngOnDestroy(): void {
    const stack = DialogDirective.stack;
    stack.splice(stack.indexOf(this), 1);
    // Rendre le focus seulement s'il était dans la modale (sinon l'utilisateur l'a déjà déplacé).
    if (this.host.contains(document.activeElement) || document.activeElement === document.body) {
      this.returnFocusTo?.focus();
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    const stack = DialogDirective.stack;
    if (stack[stack.length - 1] !== this) return;
    if (event.key === 'Escape') {
      // stopPropagation : le fond de certaines modales écoute aussi Échap, on ne ferme qu'une fois.
      event.preventDefault();
      event.stopPropagation();
      this.mtcDialogClose.emit();
    } else if (event.key === 'Tab') {
      this.trapFocus(event);
    }
  }

  private trapFocus(event: KeyboardEvent): void {
    const items = this.focusables();
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === this.host)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusables(): HTMLElement[] {
    return [...this.host.querySelectorAll<HTMLElement>(FOCUSABLE)];
  }
}
