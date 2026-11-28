import { describe, it, expect, afterEach, vi } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StickyStuckDirective } from './sticky-stuck.directive';

@Component({
  standalone: true,
  imports: [StickyStuckDirective],
  template: `<div data-testid="scroller" style="overflow-y: auto; padding-top: 16px">
    <div data-sticky-sentinel></div>
    <div data-testid="block" mtcStickyStuck style="top: 0"></div>
  </div>`,
})
class HostComponent {}

type Cb = (entries: Partial<IntersectionObserverEntry>[]) => void;

describe('StickyStuckDirective (#671)', () => {
  afterEach(() => vi.unstubAllGlobals());

  function mount() {
    const created: { cb: Cb; opts: IntersectionObserverInit; observed: Element[]; disconnect: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal('IntersectionObserver', class {
      readonly observed: Element[] = [];
      readonly disconnect = vi.fn();
      constructor(cb: Cb, opts: IntersectionObserverInit) { created.push({ cb, opts, observed: this.observed, disconnect: this.disconnect }); }
      observe(el: Element) { this.observed.push(el); }
    });
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    TestBed.tick();
    const q = (id: string) => (f.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`) as HTMLElement;
    return { f, created, block: q('block'), scroller: q('scroller') };
  }

  it('observe la sentinelle dans le conteneur de défilement, décalée de sa marge haute', () => {
    const { created, scroller } = mount();
    expect(created).toHaveLength(1);
    expect(created[0].opts.root).toBe(scroller);
    expect(created[0].opts.rootMargin).toBe('-16px 0px 0px 0px');
    expect(created[0].observed[0].hasAttribute('data-sticky-sentinel')).toBe(true);
  });

  it('sentinelle sortie par le haut : is-stuck ; revenue : retirée', () => {
    const { created, block } = mount();
    const rootBounds = { top: 16 } as DOMRectReadOnly;
    created[0].cb([{ isIntersecting: false, rootBounds, boundingClientRect: { top: 2 } as DOMRectReadOnly }]);
    expect(block.classList.contains('is-stuck')).toBe(true);
    created[0].cb([{ isIntersecting: true, rootBounds, boundingClientRect: { top: 40 } as DOMRectReadOnly }]);
    expect(block.classList.contains('is-stuck')).toBe(false);
  });

  it('sentinelle sous la zone visible (pas encore atteinte) : pas collé', () => {
    const { created, block } = mount();
    created[0].cb([{ isIntersecting: false, rootBounds: { top: 16 } as DOMRectReadOnly, boundingClientRect: { top: 900 } as DOMRectReadOnly }]);
    expect(block.classList.contains('is-stuck')).toBe(false);
  });

  it('détruit : observateur déconnecté', () => {
    const { f, created } = mount();
    f.destroy();
    expect(created[0].disconnect).toHaveBeenCalled();
  });
});
