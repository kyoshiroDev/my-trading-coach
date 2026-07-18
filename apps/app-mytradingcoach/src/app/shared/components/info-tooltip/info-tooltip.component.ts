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

  protected toggle(): void { this.open.update(v => !v); }
  protected show(): void { this.open.set(true); }
  protected hide(): void { this.open.set(false); }

  /** Un clic hors du composant ferme l'info-bulle (un seul tooltip ouvert à la fois). */
  @HostListener('document:click', ['$event'])
  protected onDocClick(e: MouseEvent): void {
    if (!this.host.nativeElement.contains(e.target as Node)) this.hide();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void { this.hide(); }
}
