/**
 * Journal — le repli d'une semaine ne doit pas dépendre de sa position.
 *
 * Constaté en vérifiant un correctif sur dev : après avoir logué un trade daté
 * d'aujourd'hui alors que le journal n'affichait que des trades de juillet, la semaine
 * de juillet — qui était ouverte — s'est repliée toute seule. Le journal paraissait
 * s'être vidé au moment précis où on venait d'y ajouter quelque chose.
 *
 * Cause : `isWeekCollapsed` retombe sur `index !== 0` quand l'utilisateur n'a rien
 * choisi. Ce défaut est POSITIONNEL, donc il se réévalue à chaque fois que la liste
 * bouge : la semaine lue passait de l'index 0 à l'index 1 et se repliait, sans que
 * personne ne l'ait repliée.
 *
 * Correctif : l'état d'ouverture est figé à l'apparition de la semaine. Ces tests
 * portent sur `isWeekCollapsed` + `freezeNewWeeks`, c'est-à-dire la règle elle-même —
 * monter le journal complet exigerait tout son étage de données pour ne rien prouver de
 * plus.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { JournalComponent } from './journal.component';
import { TradesStore } from '../../core/stores/trades.store';
import { UserStore } from '../../core/stores/user.store';
import { SetupsStore } from '../../core/stores/setups.store';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { TradesApi } from '../../core/api/trades.api';

function mount() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: TradesStore,
        useValue: {
          trades: signal([]), totalTrades: signal(0), loaded: signal(true),
          isLoading: signal(false), isLoadingMore: signal(false), hasNextPage: signal(false),
          stats: signal(null), isLoadingStats: signal(false),
          loadTrades: vi.fn(), loadMore: vi.fn(), loadStats: vi.fn(),
          reset: vi.fn(), removeTrade: vi.fn(), updateTrade: vi.fn(), addTrade: vi.fn(),
        },
      },
      {
        provide: UserStore,
        useValue: {
          isPremium: () => false, isDemo: () => false, user: () => ({}),
          startingCapital: () => 10000, displayName: () => 'Test',
        },
      },
      {
        provide: SetupsStore,
        useValue: { active: signal([]), load: vi.fn(), loaded: signal(true) },
      },
      {
        provide: SelectedAccountStore,
        useValue: {
          accounts: signal([]), activeAccounts: signal([]), accountParam: () => undefined,
          selected: () => null, selectedAccountId: signal('all'),
          load: vi.fn(), loaded: signal(true), isLoading: signal(false),
        },
      },
      { provide: TradesApi, useValue: { getStats: () => of({ data: null }) } },
    ],
  });
  TestBed.overrideComponent(JournalComponent, {
    set: {
      template: '<div></div>', imports: [], styleUrls: [],
      styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const fixture = TestBed.createComponent(JournalComponent);
  fixture.detectChanges();
  return fixture.componentInstance as any;
}

const week = (key: string) => ({ key });

describe('Journal — repli des semaines', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('par défaut : la semaine la plus récente est ouverte, les autres repliées', () => {
    const c = mount();
    c.freezeNewWeeks([week('2026-W28'), week('2026-W27')]);

    expect(c.isWeekCollapsed('2026-W28', 0)).toBe(false);
    expect(c.isWeekCollapsed('2026-W27', 1)).toBe(true);
  });

  it('une semaine ouverte le reste quand une plus récente la décale', () => {
    const c = mount();
    // Le journal n'affiche que juillet : cette semaine est en tête, donc ouverte.
    c.freezeNewWeeks([week('2026-W28')]);
    expect(c.isWeekCollapsed('2026-W28', 0)).toBe(false);

    // Un trade daté d'aujourd'hui ouvre une semaine plus récente : W28 glisse à l'index 1.
    c.freezeNewWeeks([week('2026-W35'), week('2026-W28')]);

    expect(
      c.isWeekCollapsed('2026-W28', 1),
      'La semaine consultée s\'est repliée toute seule : le journal semble vidé',
    ).toBe(false);
    expect(c.isWeekCollapsed('2026-W35', 0), 'La nouvelle semaine doit être ouverte').toBe(false);
  });

  it('une semaine repliée à son apparition le reste après un décalage', () => {
    const c = mount();
    c.freezeNewWeeks([week('2026-W35'), week('2026-W28')]);
    expect(c.isWeekCollapsed('2026-W28', 1)).toBe(true);

    // Encore un trade plus récent : W28 passe à l'index 2, elle reste repliée.
    c.freezeNewWeeks([week('2026-W36'), week('2026-W35'), week('2026-W28')]);

    expect(c.isWeekCollapsed('2026-W28', 2)).toBe(true);
  });

  it('le choix explicite de l\'utilisateur prime et survit au décalage', () => {
    const c = mount();
    c.freezeNewWeeks([week('2026-W35'), week('2026-W28')]);

    c.toggleWeek('2026-W28', 1); // l'utilisateur déplie une ancienne semaine
    expect(c.isWeekCollapsed('2026-W28', 1)).toBe(false);

    c.freezeNewWeeks([week('2026-W36'), week('2026-W35'), week('2026-W28')]);

    expect(
      c.isWeekCollapsed('2026-W28', 2),
      'Le gel a écrasé un choix explicite de l\'utilisateur',
    ).toBe(false);
  });

  it('replier la semaine du haut reste possible', () => {
    const c = mount();
    c.freezeNewWeeks([week('2026-W35')]);
    expect(c.isWeekCollapsed('2026-W35', 0)).toBe(false);

    c.toggleWeek('2026-W35', 0);

    expect(c.isWeekCollapsed('2026-W35', 0)).toBe(true);
  });

  it('les semaines révélées par « Charger plus » arrivent repliées', () => {
    const c = mount();
    c.freezeNewWeeks([week('2026-W35')]);

    // Pagination : des semaines plus anciennes apparaissent en bas de liste.
    c.freezeNewWeeks([week('2026-W35'), week('2026-W34'), week('2026-W33')]);

    expect(c.isWeekCollapsed('2026-W34', 1)).toBe(true);
    expect(c.isWeekCollapsed('2026-W33', 2)).toBe(true);
    expect(c.isWeekCollapsed('2026-W35', 0)).toBe(false);
  });
});
