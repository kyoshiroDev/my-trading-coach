import { describe, it, expect, beforeAll, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import * as angularCore from '@angular/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorStateComponent } from './error-state.component';

const resolveResources = (angularCore as Record<string, unknown>)['ɵresolveComponentResources'] as (
  resolver: (url: string) => Promise<{ text(): Promise<string> }>,
) => Promise<void>;

describe('ErrorStateComponent', () => {
  beforeAll(async () => {
    await resolveResources(() => Promise.resolve({ text: () => Promise.resolve('') }));
  });

  it('annonce l’erreur (role=alert) et émet retry au clic', async () => {
    TestBed.configureTestingModule({ providers: [angularCore.provideZonelessChangeDetection()] });
    const fixture = TestBed.createComponent(ErrorStateComponent);
    const retry = vi.fn();
    fixture.componentInstance.retry.subscribe(retry);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('n’ont pas pu être chargées');
    (el.querySelector('[data-testid="error-state-retry"]') as HTMLButtonElement).click();
    expect(retry).toHaveBeenCalledOnce();
  });

  /**
   * #1101 : le rouge de l'app trader était écrit en dur (rgba(239, 68, 68, …)) ; dans l'admin il ne
   * correspondait pas à son --red (#ff5563). Le composant suit le --red / --red-dim de chaque app.
   */
  it('rouge du thème de chaque app, aucune couleur rouge écrite en dur', () => {
    const css = readFileSync(join(import.meta.dirname, 'error-state.component.css'), 'utf8');
    expect(css).not.toMatch(/rgba?\(\s*239\s*,\s*68\s*,\s*68/);
    expect(css).not.toMatch(/#ef4444|#ff5563/i);
    expect(css).toContain('var(--red');
  });
});
