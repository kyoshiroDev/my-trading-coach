import {
  ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, inject, input, signal,
} from '@angular/core';

/**
 * Icône d'aide « ? » + info-bulle expliquant comment une métrique est calculée.
 * Accessible : survol (desktop), tap (mobile), focus clavier + Échap.
 * À réserver aux données calculées ou ambiguës — jamais décoratif.
 *
 * La bulle est rendue dans `document.body` (portail manuel) pour échapper à TOUT conteneur
 * `overflow:hidden` ET à tout contexte d'empilement d'un ancêtre (sinon la bulle passe
 * derrière les cartes voisines — cas Dashboard/Analytics).
 */
@Component({
  selector: 'mtc-info-tooltip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="it-btn"
      [attr.aria-label]="label()"
      [attr.aria-expanded]="open()"
      (click)="toggle(); $event.stopPropagation()"
      (mouseenter)="show()"
      (mouseleave)="hide()"
      (focus)="show()"
      (blur)="hide()"
    >?</button>
  `,
  styleUrl: './info-tooltip.component.css',
})
export class InfoTooltipComponent implements OnDestroy {
  /** Texte affiché dans l'info-bulle. */
  readonly text = input.required<string>();
  /** Libellé accessible du bouton (ex. « Comment le win rate est calculé »). */
  readonly label = input<string>('Aide');

  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly open = signal(false);
  /** Élément de bulle vivant dans document.body tant qu'ouverte. */
  private bubble: HTMLElement | null = null;

  protected toggle(): void {
    if (this.open()) this.hide(); else this.show();
  }

  protected show(): void {
    if (this.open()) return;
    const el = this.host.nativeElement as HTMLElement;
    const btn = el.querySelector('.it-btn') as HTMLElement | null;
    if (!btn) return;

    const r = btn.getBoundingClientRect();
    // Ancre horizontale + transform selon l'alignement (bord droit / gauche / centré).
    // translateY(-100%) → bulle au-dessus du « ? » sans mesurer sa hauteur.
    let left = r.left + r.width / 2;
    let transform = 'translate(-50%, -100%)';
    if (el.classList.contains('align-end')) { left = r.right; transform = 'translate(-100%, -100%)'; }
    else if (el.classList.contains('align-start')) { left = r.left; transform = 'translateY(-100%)'; }

    const b = document.createElement('span');
    b.className = 'it-content';
    b.setAttribute('role', 'tooltip');
    b.textContent = this.text();
    b.style.top = `${r.top - 7}px`;
    b.style.left = `${left}px`;
    b.style.transform = transform;
    document.body.appendChild(b);
    this.bubble = b;
    this.open.set(true);
  }

  protected hide(): void {
    this.bubble?.remove();
    this.bubble = null;
    if (this.open()) this.open.set(false);
  }

  /** Un clic hors du composant ferme l'info-bulle. */
  @HostListener('document:click', ['$event'])
  protected onDocClick(e: MouseEvent): void {
    if (!this.host.nativeElement.contains(e.target as Node)) this.hide();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void { this.hide(); }

  // La bulle est en position:fixed (ancrée au viewport à l'ouverture) → un scroll la détacherait ; on ferme.
  @HostListener('window:scroll')
  protected onScroll(): void { this.hide(); }

  ngOnDestroy(): void { this.hide(); }
}
