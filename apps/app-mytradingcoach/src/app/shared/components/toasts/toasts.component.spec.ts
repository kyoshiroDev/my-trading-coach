import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ToastsComponent } from './toasts.component';
import { ToastService, TOAST_DURATIONS } from '@app/core/services/toast.service';
import TEMPLATE from './toasts.component.html?raw';

/** Conteneur racine : VRAI template (import `?raw`), icônes Lucide neutralisées (JIT). */
function mount() {
  TestBed.configureTestingModule({});
  TestBed.overrideComponent(ToastsComponent, {
    set: { template: TEMPLATE, imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(ToastsComponent);
  const service = TestBed.inject(ToastService);
  const el = fixture.nativeElement as HTMLElement;
  const render = () => fixture.detectChanges();
  const msgs = () => [...el.querySelectorAll('.toast-msg')].map((n) => n.textContent);
  return { fixture, service, el, render, msgs };
}

/** jsdom n'a pas toujours PointerEvent : un MouseEvent du bon type suffit aux handlers. */
function pointer(target: Element, type: string, clientX: number, pointerType = 'touch') {
  const e = new MouseEvent(type, { clientX, bubbles: true, cancelable: true });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  target.dispatchEvent(e);
}

describe('mtc-toasts — rendu et accessibilité', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('succès / info : role=status + aria-live=polite ; erreur : role=alert + assertive', () => {
    const { service, el, render } = mount();
    service.success('Lien copié');
    service.error('Échec de suppression');
    render();
    const ok = el.querySelector('[data-testid="toast-success"]')!;
    const ko = el.querySelector('[data-testid="toast-error"]')!;
    expect(ok.getAttribute('role')).toBe('status');
    expect(ok.getAttribute('aria-live')).toBe('polite');
    expect(ko.getAttribute('role')).toBe('alert');
    expect(ko.getAttribute('aria-live')).toBe('assertive');
    expect(ok.textContent).toContain('Lien copié');
  });

  it('la croix ferme CE toast, avec un libellé accessible', () => {
    const { service, el, render, msgs } = mount();
    service.info('A');
    service.info('B');
    render();
    const close = el.querySelectorAll<HTMLButtonElement>('[data-testid="toast-close"]');
    expect(close[0].getAttribute('aria-label')).toBe('Fermer la notification');
    close[0].click();
    render();
    expect(msgs()).toEqual(['B']);
  });

  it('au-delà de 3 : indicateur de file « +N »', () => {
    const { service, el, render } = mount();
    ['1', '2', '3', '4', '5'].forEach((m) => service.info(m));
    render();
    expect(el.querySelectorAll('.toast')).toHaveLength(3);
    expect(el.querySelector('.toast-queue')!.textContent).toContain('+2');
  });

  it('survol : pause du minuteur, sortie : reprise', () => {
    const { service, el, render } = mount();
    service.success('Survole-moi');
    render();
    const node = el.querySelector('.toast')!;
    const id = service.visible()[0].id;
    node.dispatchEvent(new Event('mouseenter'));
    expect(service.isPaused(id)).toBe(true);
    node.dispatchEvent(new Event('mouseleave'));
    expect(service.isPaused(id)).toBe(false);
  });
});

describe('mtc-toasts — barre de compte à rebours (en haut)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('présente, EN PREMIER dans le toast, avec la durée réelle du type', () => {
    const { service, el, render } = mount();
    service.error('Échec');
    render();
    const toast = el.querySelector('.toast')!;
    const bar = toast.querySelector<HTMLElement>('[data-testid="toast-bar"]')!;
    expect(toast.firstElementChild).toBe(bar); // en haut : avant l'icône et le message
    expect(bar.getAttribute('aria-hidden')).toBe('true');
    expect(bar.style.animationDuration).toBe(`${TOAST_DURATIONS.error}ms`);
  });

  it('figée tant que le toast est en pause', () => {
    const { service, el, render } = mount();
    const id = service.success('x');
    render();
    const bar = () => el.querySelector('[data-testid="toast-bar"]')!;
    expect(bar().classList).not.toContain('paused');
    service.pause(id);
    render();
    expect(bar().classList).toContain('paused');
    service.resume(id);
    render();
    expect(bar().classList).not.toContain('paused');
  });

  it('absente sur un toast sans fermeture automatique', () => {
    const { service, el, render } = mount();
    service.warning('Reste là', { duration: null });
    render();
    expect(el.querySelector('[data-testid="toast-bar"]')).toBeNull();
  });

  it('même message relancé : la barre est RECRÉÉE (elle repart de zéro)', () => {
    const { service, el, render } = mount();
    service.error('Échec réseau');
    render();
    const first = el.querySelector('[data-testid="toast-bar"]');
    service.error('Échec réseau');
    render();
    const second = el.querySelector('[data-testid="toast-bar"]');
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });
});

describe('mtc-toasts — glisser pour fermer', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('au-delà du seuil : fermé ; le minuteur est suspendu pendant le geste', () => {
    const { service, el, render, msgs } = mount();
    const id = service.info('Chasse-moi');
    render();
    const toast = el.querySelector('.toast')!;
    pointer(toast, 'pointerdown', 100);
    expect(service.isPaused(id)).toBe(true);
    pointer(toast, 'pointermove', 220);
    render();
    expect((toast as HTMLElement).style.transform).toBe('translateX(120px)');
    pointer(toast, 'pointerup', 220);
    render();
    expect(msgs()).toEqual([]);
  });

  it('en deçà du seuil : le toast revient en place et le minuteur reprend', () => {
    const { service, el, render, msgs } = mount();
    const id = service.info('Reste');
    render();
    const toast = el.querySelector<HTMLElement>('.toast')!;
    pointer(toast, 'pointerdown', 100);
    pointer(toast, 'pointermove', 130);
    pointer(toast, 'pointerup', 130);
    render();
    expect(msgs()).toEqual(['Reste']);
    expect(toast.style.transform).toBe('');
    expect(service.isPaused(id)).toBe(false);
  });

  it('vers la gauche : la sortie part de ce côté ; vers la droite : sortie par défaut', () => {
    const { service, el, render, fixture } = mount();
    const leaveClass = (id: number) =>
      (fixture.componentInstance as unknown as { leaveClass: (i: number) => string }).leaveClass(id);

    const gauche = service.info('À gauche');
    const droite = service.info('À droite');
    render();
    const [tG, tD] = [...el.querySelectorAll('.toast')];

    pointer(tG, 'pointerdown', 300);
    pointer(tG, 'pointermove', 150);
    pointer(tG, 'pointerup', 150);
    pointer(tD, 'pointerdown', 100);
    pointer(tD, 'pointermove', 250);
    pointer(tD, 'pointerup', 250);

    expect(leaveClass(gauche)).toBe('toast-leave toast-leave-left');
    expect(leaveClass(droite)).toBe('toast-leave');
  });

  it('un appui sur la croix n’est pas un glisser', () => {
    const { service, el, render } = mount();
    const id = service.info('Croix');
    render();
    pointer(el.querySelector('[data-testid="toast-close"]')!, 'pointerdown', 100);
    expect(service.isPaused(id)).toBe(false);
  });
});
