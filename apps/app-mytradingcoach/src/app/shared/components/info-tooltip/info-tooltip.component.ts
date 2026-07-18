import {
  ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, input, signal,
} from '@angular/core';

/**
 * Icône d'aide « ? » + info-bulle expliquant comment une métrique est calculée.
 * Accessible : survol (desktop), tap (mobile), focus clavier + Échap.
 * À réserver aux données calculées ou ambiguës — jamais décoratif.
 */
@Component({
  selector: 'mtc-info-tooltip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './info-tooltip.component.html',
  styleUrl: './info-tooltip.component.css',
})
export class InfoTooltipComponent {
  /** Texte affiché dans l'info-bulle. */
  readonly text = input.required<string>();
  /** Libellé accessible du bouton (ex. « Comment le win rate est calculé »). */
  readonly label = input<string>('Aide');

  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly open = signal(false);
  /** Ancre viewport de la bulle (position:fixed → échappe les conteneurs overflow:hidden). */
  protected readonly anchor = signal<{ top: number; left: number }>({ top: 0, left: 0 });

  protected toggle(): void { if (this.open()) this.hide(); else this.show(); }

  protected show(): void {
    const el = this.host.nativeElement as HTMLElement;
    const btn = el.querySelector('.it-btn') as HTMLElement | null;
    if (btn) {
      const r = btn.getBoundingClientRect();
      // left = point d'ancrage horizontal ; le décalage réel (centré / bord) est géré par le transform CSS.
      let left = r.left + r.width / 2;
      if (el.classList.contains('align-end')) left = r.right;
      else if (el.classList.contains('align-start')) left = r.left;
      this.anchor.set({ top: r.top - 7, left });
    }
    this.open.set(true);
  }

  protected hide(): void { this.open.set(false); }

  /** Un clic hors du composant ferme l'info-bulle (un seul tooltip ouvert à la fois). */
  @HostListener('document:click', ['$event'])
  protected onDocClick(e: MouseEvent): void {
    if (!this.host.nativeElement.contains(e.target as Node)) this.hide();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void { this.hide(); }
}
