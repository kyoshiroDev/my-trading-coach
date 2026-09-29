import { describe, it, expect, beforeAll, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import * as angularCore from '@angular/core';
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
});
