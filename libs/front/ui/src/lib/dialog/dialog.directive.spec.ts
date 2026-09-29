import { describe, it, expect, beforeEach } from 'vitest';
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DialogDirective } from './dialog.directive';

@Component({
  imports: [DialogDirective],
  template: `
    <button id="opener" (click)="open.set(true)">Ouvrir</button>
    @if (open()) {
      <div mtcDialog aria-labelledby="t" (mtcDialogClose)="open.set(false)">
        <h2 id="t">Titre</h2>
        <button id="first">Un</button>
        <button id="last">Deux</button>
      </div>
    }
  `,
})
class HostComponent {
  readonly open = signal(false);
}

const key = (el: Element, k: string, shiftKey = false) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));
const tick = () => new Promise((r) => setTimeout(r));

describe('DialogDirective', () => {
  let root: HTMLElement;
  let fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    fixture = TestBed.createComponent(HostComponent);
    root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    fixture.autoDetectChanges();
    const opener = root.querySelector<HTMLButtonElement>('#opener')!;
    opener.focus();
    opener.click();
    await fixture.whenStable();
    await tick();
  });

  const dialog = () => root.querySelector<HTMLElement>('[mtcDialog]');

  it('expose role=dialog et aria-modal', () => {
    expect(dialog()!.getAttribute('role')).toBe('dialog');
    expect(dialog()!.getAttribute('aria-modal')).toBe('true');
  });

  it('place le focus sur le premier élément focusable', () => {
    expect(document.activeElement?.id).toBe('first');
  });

  it('garde le focus dans la modale (Tab sur le dernier → premier, Maj+Tab sur le premier → dernier)', () => {
    root.querySelector<HTMLElement>('#last')!.focus();
    key(document.activeElement!, 'Tab');
    expect(document.activeElement?.id).toBe('first');
    key(document.activeElement!, 'Tab', true);
    expect(document.activeElement?.id).toBe('last');
  });

  it('Échap ferme la modale et rend le focus au bouton d’ouverture', async () => {
    key(document.activeElement!, 'Escape');
    await fixture.whenStable();
    expect(dialog()).toBeNull();
    expect(document.activeElement?.id).toBe('opener');
  });
});
