import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  inject,
  viewChild,
} from '@angular/core';
import { ConfirmService } from './confirm.service';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialogue de confirmation (voir ConfirmService). Accessibilité :
 * - `role="alertdialog"`, titre et message reliés par aria-labelledby / aria-describedby ;
 * - focus placé sur « Annuler » à l'ouverture (le choix sûr), piégé dans le dialogue (Tab),
 *   rendu à l'élément d'origine à la fermeture ;
 * - Échap ou clic sur le fond = annuler.
 */
@Component({
  selector: 'mtc-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.css',
  host: { '(document:keydown.escape)': 'onEscape()' },
})
export class ConfirmDialogComponent {
  protected readonly confirm = inject(ConfirmService);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  /** N'existe que dialogue ouvert : son apparition déclenche la mise au focus. */
  private readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');
  private returnFocusTo: HTMLElement | null = null;

  constructor() {
    // Après le rendu (le bouton est dans le DOM) : focus sur « Annuler », une fois par ouverture.
    afterRenderEffect(() => {
      const cancel = this.cancelButton()?.nativeElement;
      if (!cancel || this.returnFocusTo) return;
      this.returnFocusTo = (document.activeElement as HTMLElement | null) ?? document.body;
      cancel.focus();
    });
  }

  protected answer(confirmed: boolean): void {
    this.confirm.answer(confirmed);
    const target = this.returnFocusTo;
    this.returnFocusTo = null;
    target?.focus();
  }

  protected onEscape(): void {
    if (this.confirm.pending()) this.answer(false);
  }

  /** Garde le focus clavier dans le dialogue. */
  protected trapFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const items = [...(this.dialog()?.nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
