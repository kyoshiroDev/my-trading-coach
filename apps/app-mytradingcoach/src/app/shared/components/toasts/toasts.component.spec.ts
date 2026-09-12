import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ToastsComponent } from './toasts.component';
import { ToastService } from '../../../core/services/toast.service';
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
  return { fixture, service, el, render };
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
    const { service, el, render } = mount();
    service.info('A');
    service.info('B');
    render();
    const close = el.querySelectorAll<HTMLButtonElement>('[data-testid="toast-close"]');
    expect(close[0].getAttribute('aria-label')).toBe('Fermer la notification');
    close[0].click();
    render();
    expect([...el.querySelectorAll('.toast-msg')].map((n) => n.textContent)).toEqual(['B']);
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
    const calls: string[] = [];
    const pause = service.pause.bind(service);
    const resume = service.resume.bind(service);
    service.pause = (i: number) => { calls.push(`pause:${i}`); pause(i); };
    service.resume = (i: number) => { calls.push(`resume:${i}`); resume(i); };
    node.dispatchEvent(new Event('mouseenter'));
    node.dispatchEvent(new Event('mouseleave'));
    expect(calls).toEqual([`pause:${id}`, `resume:${id}`]);
  });
});
