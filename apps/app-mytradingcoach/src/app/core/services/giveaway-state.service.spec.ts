import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import type { GiveawayAppState } from '@mtc/shared';
import { GiveawayStateService } from './giveaway-state.service';
import { GiveawayApi } from '../api/giveaway.api';
import { UserScopedReset } from '../auth/user-scoped-reset';

/** État du tirage mensuel partagé (barre latérale + page) : chargement, erreur, déconnexion. */
const STATE = { enabled: true } as GiveawayAppState;

function setup(state: () => unknown) {
  const api = { state: vi.fn(state) };
  TestBed.configureTestingModule({ providers: [{ provide: GiveawayApi, useValue: api }] });
  return { service: TestBed.inject(GiveawayStateService), api, resets: TestBed.inject(UserScopedReset) };
}

describe('GiveawayStateService', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('succès : état rempli, entrée « Concours du mois » activée', () => {
    const { service } = setup(() => of({ data: STATE }));
    service.load();
    expect(service.state()).toEqual(STATE);
    expect(service.enabled()).toBe(true);
    expect(service.loadError()).toBe(false);
  });

  it('erreur : loadError, état vide, la navigation reste comme avant', () => {
    const { service } = setup(() => throwError(() => new Error('boom')));
    service.load();
    expect(service.loadError()).toBe(true);
    expect(service.state()).toBeNull();
    expect(service.enabled()).toBe(false);
  });

  it('déconnexion (UserScopedReset) : état vidé', () => {
    const { service, resets } = setup(() => of({ data: STATE }));
    service.load();
    resets.resetAll();
    expect(service.state()).toBeNull();
    expect(service.enabled()).toBe(false);
  });

  it('second load() pendant un chargement : une seule requête ; réponse après déconnexion ignorée', () => {
    const pending = new Subject<{ data: GiveawayAppState }>();
    const { service, api, resets } = setup(() => pending);
    service.load();
    service.load();
    expect(api.state).toHaveBeenCalledTimes(1);
    resets.resetAll();
    pending.next({ data: STATE });
    expect(service.state()).toBeNull();
  });
});
