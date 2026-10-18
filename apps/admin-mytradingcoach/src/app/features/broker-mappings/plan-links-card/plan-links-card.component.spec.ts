import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AdminApi, type AdminPlanLinkStats } from '../../../core/api/admin.api';
import { PlanLinksCardComponent } from './plan-links-card.component';

const STATS: AdminPlanLinkStats = {
  connected: 6, linked: 2, rate: 33,
  unlinked: { later: 1, personal: 1, unlisted: 1, none: 1 },
  unlistedFirms: [{ name: 'FTMO', count: 2, lastAt: '2026-10-18T10:00:00.000Z' }],
};

function mount(planLinks: () => unknown) {
  TestBed.configureTestingModule({ providers: [{ provide: AdminApi, useValue: { planLinks } }] });
  const fixture = TestBed.createComponent(PlanLinksCardComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return (id: string) => (el.querySelector(`[data-testid="${id}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('PlanLinksCardComponent — liaison compte ↔ plan (#612)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('taux, reliés / connectés, réponses des comptes sans plan et firms à ajouter', () => {
    const text = mount(() => of({ data: STATS }));
    expect(text('plan-links-rate')).toBe('33 %');
    expect(text('plan-links-card')).toContain('2 / 6 comptes connectés');
    expect(text('plan-links-unlinked')).toContain('1 « plus tard »');
    expect(text('plan-links-unlisted')).toContain('FTMO');
    expect(text('plan-links-unlisted')).toContain('2 ·');
  });

  it('API en échec : le dit, sans chiffre inventé', () => {
    const text = mount(() => throwError(() => new Error('500')));
    expect(text('plan-links-card')).toContain('Mesure indisponible');
    expect(text('plan-links-rate')).toBe('');
  });
});
