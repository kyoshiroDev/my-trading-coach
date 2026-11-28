import { DestroyRef, Directive, ElementRef, Renderer2, afterNextRender, inject } from '@angular/core';

/**
 * Pose la classe `is-stuck` sur un bloc `position: sticky` quand il colle (#671). Le fond qui masque le contenu
 * défilant au-dessus du bloc (marge haute du conteneur de défilement, bouton menu mobile) n'est posé qu'à ce
 * moment : au repos il recouvrirait l'en-tête de la page.
 *
 * Sentinelle : l'élément juste avant le bloc, marqué `data-sticky-sentinel` dans le template (styles dans le
 * CSS du composant). Quand elle sort par le haut de la zone où le bloc colle (marge haute du conteneur de
 * défilement + `top` du bloc), le bloc est collé. Sans IntersectionObserver ou sans sentinelle : rien.
 */
@Directive({ selector: '[mtcStickyStuck]', standalone: true })
export class StickyStuckDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.host.nativeElement;
      const sentinel = el.previousElementSibling;
      if (typeof IntersectionObserver === 'undefined' || !sentinel?.hasAttribute('data-sticky-sentinel')) return;

      const root = scrollParent(el);
      const offset = px(root ? getComputedStyle(root).paddingTop : '0') + px(getComputedStyle(el).top);
      const io = new IntersectionObserver(
        ([entry]) => {
          const top = entry.rootBounds?.top ?? 0;
          const stuck = !entry.isIntersecting && entry.boundingClientRect.top < top;
          if (stuck) this.renderer.addClass(el, 'is-stuck');
          else this.renderer.removeClass(el, 'is-stuck');
        },
        { root, rootMargin: `-${Math.max(0, Math.round(offset))}px 0px 0px 0px`, threshold: 0 },
      );
      io.observe(sentinel);
      destroyRef.onDestroy(() => io.disconnect());
    });
  }
}

function px(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
}
