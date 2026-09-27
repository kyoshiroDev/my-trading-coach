/**
 * Journal — la suppression de trades échouait en silence.
 *
 * Constaté en nettoyant des données de test sur dev, dans cet ordre exact :
 * deux trades supprimés un par un, puis « supprimer la journée » sur les 20 restants.
 * La modale annonçait encore « 22 trades » et le clic n'a produit aucun effet visible
 * — modale figée ouverte, compteur inchangé, aucun message. Un rechargement a révélé
 * que les 20 suppressions étaient bel et bien parties côté serveur.
 *
 * Trois défauts imbriqués :
 *
 * 1. `confirmDeleteDay` gardait un INSTANTANÉ du `DayGroup` pris à l'ouverture. Les
 *    groupes sont recalculés à chaque changement du store : l'instantané se périmait
 *    dès qu'un trade partait, d'où le compte faux ET des ids déjà supprimés rejoués.
 * 2. `forkJoin` s'arrête à la PREMIÈRE erreur. Les 2 ids périmés renvoyaient 404, donc
 *    la branche d'erreur l'emportait alors que 20 suppressions avaient réussi — et
 *    cette branche ne retirait aucune ligne. L'écran mentait sur l'état du serveur.
 * 3. Cette branche ne faisait que relâcher le spinner : `error: () => this.isDeletingDay.set(false)`.
 *    Aucun message. Même classe de bug que PROMPT-204, sur l'écran voisin.
 *
 * `deleteTrade` (la croix de chaque ligne) n'avait, lui, aucun handler `error` du tout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { provideRouter } from '@angular/router';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { JournalComponent } from './journal.component';
import { TradesStore, Trade } from '../../core/stores/trades.store';
import { UserStore } from '../../core/stores/user.store';
import { SetupsStore } from '../../core/stores/setups.store';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { TradesApi } from '../../core/api/trades.api';
import { ToastService } from '../../core/services/toast.service';
import { environment } from '../../../environments/environment';

const JOUR = '2026-07-10T16:41:00.000Z';

function trade(id: string): Trade {
  return {
    id, asset: 'MNQ', side: 'SHORT', entry: 29884, exit: 29851.5, pnl: 62.92,
    quantity: 1, tradedAt: JOUR, setupId: null, emotion: null, commission: null,
  } as unknown as Trade;
}

/**
 * Store minimal mais VIVANT : `removeTrade` retire réellement du signal, sans quoi
 * les groupes ne se recalculeraient pas et le test ne pourrait rien dire de la
 * péremption — le défaut central de ce correctif.
 */
function storeVivant(trades: Trade[]) {
  const liste = signal<Trade[]>(trades);
  return {
    trades: liste,
    totalTrades: signal(trades.length),
    loaded: signal(true), isLoading: signal(false), isLoadingMore: signal(false),
    hasNextPage: signal(false), stats: signal(null), isLoadingStats: signal(false),
    loadTrades: vi.fn(), loadMore: vi.fn(), loadStats: vi.fn(), reset: vi.fn(),
    updateTrade: vi.fn(), addTrade: vi.fn(),
    removeTrade: vi.fn((id: string) => liste.set(liste().filter((t) => t.id !== id))),
  };
}

function mount(trades: Trade[], reassignImpl: () => unknown = () => of({ data: { moved: 0 } })) {
  const store = storeVivant(trades);
  const tradesApi = {
    getStats: () => of({ data: null }),
    reassign: vi.fn(reassignImpl),
    // Le journal supprime via TradesApi (étape 4 de l'audit) : le mock émet la VRAIE requête
    // DELETE, pour que HttpTestingController continue de simuler 404 / refus / échecs partiels.
    delete: (id: string) => TestBed.inject(HttpClient).delete<void>(`${environment.apiUrl}/trades/${id}`),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: TradesStore, useValue: store },
      {
        provide: UserStore,
        useValue: {
          isPremium: () => false, isDemo: () => false, user: () => ({}),
          startingCapital: () => 10000, displayName: () => 'Test',
        },
      },
      { provide: SetupsStore, useValue: { active: signal([]), load: vi.fn(), loaded: signal(true) } },
      {
        provide: SelectedAccountStore,
        useValue: {
          accounts: signal([]), activeAccounts: signal([]), accountParam: () => undefined,
          selected: () => null, selectedAccountId: signal('all'),
          load: vi.fn(), loaded: signal(true), isLoading: signal(false),
        },
      },
      { provide: TradesApi, useValue: tradesApi },
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
  const http = TestBed.inject(HttpTestingController);
  return { c: fixture.componentInstance as any, http, store, fixture, tradesApi };
}

/** Répond aux DELETE en attente : `sorts` donne le statut par id (200 par défaut). */
function repondre(http: HttpTestingController, sorts: Record<string, number> = {}) {
  for (const req of http.match((r) => r.method === 'DELETE')) {
    const id = req.request.url.split('/').pop()!;
    const code = sorts[id] ?? 200;
    if (code === 200) req.flush({});
    else req.flush({ message: 'Refus serveur.' }, { status: code, statusText: 'Err' });
  }
}

beforeEach(() => TestBed.resetTestingModule());
/** Toasts affichés (le service réel, racine) : { type, message }. */
const toasts = () => TestBed.inject(ToastService).visible().map((t) => ({ type: t.type, message: t.message }));
afterEach(() => TestBed.inject(HttpTestingController).verify());

describe('Journal — la modale de journée reste synchronisée avec les trades', () => {
  it('le compte annoncé suit les suppressions faites entre-temps', () => {
    const { c, http, fixture } = mount([trade('a'), trade('b'), trade('c')]);
    c.confirmDeleteDayKey.set(c.tradesByDay()[0].key);
    fixture.detectChanges(); // la modale s'affiche avant tout clic
    expect(c.confirmDeleteDay().count).toBe(3);

    c.deleteTrade('a');
    repondre(http);
    fixture.detectChanges();

    expect(
      c.confirmDeleteDay().count,
      'La modale garde un instantané : elle annonce un nombre de trades qui n\'existe plus',
    ).toBe(2);
  });

  it('ne rejoue pas les ids déjà supprimés', () => {
    const { c, http, fixture } = mount([trade('a'), trade('b'), trade('c')]);
    c.confirmDeleteDayKey.set(c.tradesByDay()[0].key);
    fixture.detectChanges(); // la modale s'affiche avant tout clic
    c.deleteTrade('a');
    repondre(http);
    fixture.detectChanges();

    c.deleteDay(c.confirmDeleteDay());
    const envoyes = http.match((r) => r.method === 'DELETE').map((r) => {
      r.flush({});
      return r.request.url.split('/').pop();
    });

    expect(
      envoyes.sort(),
      'Le trade « a » est renvoyé alors qu\'il est déjà parti : 404 garanti',
    ).toEqual(['b', 'c']);
  });

  it('la journée vidée referme la modale', () => {
    const { c, http, fixture } = mount([trade('a')]);
    c.confirmDeleteDayKey.set(c.tradesByDay()[0].key);
    fixture.detectChanges(); // la modale s'affiche avant tout clic

    c.deleteDay(c.confirmDeleteDay());
    repondre(http);
    fixture.detectChanges();

    expect(c.confirmDeleteDayKey()).toBeNull();
    expect(c.deleteDayError()).toBeNull();
  });
});

describe('Journal — un échec de suppression de journée est désormais visible', () => {
  it('échec partiel : ce qui est parti disparaît, ce qui résiste est annoncé', () => {
    const { c, http, store, fixture } = mount([trade('a'), trade('b'), trade('c')]);
    c.confirmDeleteDayKey.set(c.tradesByDay()[0].key);
    fixture.detectChanges(); // la modale s'affiche avant tout clic

    c.deleteDay(c.confirmDeleteDay());
    repondre(http, { c: 500 });
    fixture.detectChanges();

    expect(
      store.trades().map((t: Trade) => t.id),
      'Les suppressions réussies restent affichées : l\'écran ment sur l\'état du serveur',
    ).toEqual(['c']);
    expect(c.deleteDayError()).toBe("1 trade n'a pas pu être supprimé.");
    expect(c.isDeletingDay(), 'Le spinner reste bloqué').toBe(false);
    expect(
      c.confirmDeleteDayKey(),
      'Fermer la modale masquerait le seul endroit où le refus est expliqué',
    ).not.toBeNull();
  });

  it('échec total : message au pluriel, aucune ligne retirée', () => {
    const { c, http, store, fixture } = mount([trade('a'), trade('b')]);
    c.confirmDeleteDayKey.set(c.tradesByDay()[0].key);
    fixture.detectChanges(); // la modale s'affiche avant tout clic

    c.deleteDay(c.confirmDeleteDay());
    repondre(http, { a: 500, b: 500 });
    fixture.detectChanges();

    expect(store.trades()).toHaveLength(2);
    expect(c.deleteDayError()).toBe("2 trades n'ont pas pu être supprimés.");
  });

  it('un 404 vaut succès : le trade n\'est plus là, c\'est ce qu\'on voulait', () => {
    // C'est le cas réel rencontré sur dev. Le compter comme un échec afficherait une
    // erreur pour un objectif atteint, et laisserait la ligne d'un trade inexistant.
    const { c, http, store, fixture } = mount([trade('a'), trade('b')]);
    c.confirmDeleteDayKey.set(c.tradesByDay()[0].key);
    fixture.detectChanges(); // la modale s'affiche avant tout clic

    c.deleteDay(c.confirmDeleteDay());
    repondre(http, { a: 404 });
    fixture.detectChanges();

    expect(store.trades()).toHaveLength(0);
    expect(c.deleteDayError()).toBeNull();
    expect(c.confirmDeleteDayKey()).toBeNull();
  });

  it('fermer la modale efface le message', () => {
    const { c, http, fixture } = mount([trade('a')]);
    c.confirmDeleteDayKey.set(c.tradesByDay()[0].key);
    fixture.detectChanges(); // la modale s'affiche avant tout clic
    c.deleteDay(c.confirmDeleteDay());
    repondre(http, { a: 500 });
    fixture.detectChanges();
    expect(c.deleteDayError()).not.toBeNull();

    c.confirmDeleteDayKey.set(null);
    fixture.detectChanges();

    expect(c.deleteDayError()).toBeNull();
  });
});

describe('Journal — un échec de suppression de ligne est désormais visible (toast)', () => {
  it('refus serveur → toast d’erreur avec le message du back, ligne conservée', () => {
    const { c, http, store, fixture } = mount([trade('a')]);

    c.deleteTrade('a');
    repondre(http, { a: 400 });
    fixture.detectChanges();

    expect(
      toasts(),
      'Le clic sur la croix ne produit rien de visible et la ligne reste en place',
    ).toEqual([{ type: 'error', message: 'Refus serveur.' }]);
    expect(store.trades()).toHaveLength(1);
  });

  it('erreur sans message serveur → repli lisible, jamais « undefined »', () => {
    const { c, http, fixture } = mount([trade('a')]);

    c.deleteTrade('a');
    for (const req of http.match((r) => r.method === 'DELETE')) {
      req.flush(null, { status: 500, statusText: 'Err' });
    }
    fixture.detectChanges();

    expect(toasts()[0].message).toContain("n'a pas pu être supprimé");
    expect(toasts()[0].message).not.toContain('undefined');
  });

  it('404 → la ligne disparaît quand même, présentée comme un succès', () => {
    // Sinon elle resterait cliquable indéfiniment sur un trade qui n'existe plus.
    const { c, http, store, fixture } = mount([trade('a'), trade('b')]);

    c.deleteTrade('a');
    repondre(http, { a: 404 });
    fixture.detectChanges();

    expect(store.trades().map((t: Trade) => t.id)).toEqual(['b']);
    expect(toasts()).toEqual([{ type: 'success', message: 'Trade supprimé' }]);
  });

  it('succès → toast « Trade supprimé », ligne retirée', () => {
    const { c, http, store, fixture } = mount([trade('a'), trade('b')]);

    c.deleteTrade('a');
    repondre(http);
    fixture.detectChanges();

    expect(store.trades().map((t: Trade) => t.id)).toEqual(['b']);
    expect(toasts()).toEqual([{ type: 'success', message: 'Trade supprimé' }]);
  });
});

describe('Journal — la modale de déplacement suit elle aussi les trades', () => {
  it('déplace les ids réellement présents, pas ceux de l\'ouverture', () => {
    const { c, http, fixture, tradesApi } = mount([trade('a'), trade('b'), trade('c')]);
    c.openReassign(c.tradesByDay()[0]);
    fixture.detectChanges(); // la modale s'affiche avant tout clic

    c.deleteTrade('a');
    repondre(http);
    fixture.detectChanges();

    c.reassignTo(c.reassignDay(), 'compte-2');

    expect(
      ((tradesApi.reassign.mock.calls[0] as unknown[])[0] as string[]).sort(),
      'Le trade « a » est déplacé alors qu\'il n\'existe plus',
    ).toEqual(['b', 'c']);
  });

  it('le compte annoncé suit les suppressions faites entre-temps', () => {
    const { c, http, fixture } = mount([trade('a'), trade('b')]);
    c.openReassign(c.tradesByDay()[0]);
    fixture.detectChanges();
    expect(c.reassignDay().count).toBe(2);

    c.deleteTrade('a');
    repondre(http);
    fixture.detectChanges();

    expect(c.reassignDay().count).toBe(1);
  });

  it('journée vidée entre-temps : rien n\'est envoyé, la modale se ferme', () => {
    // Sinon on déplacerait une liste vide, et le back répondrait un refus incompréhensible.
    const { c, http, fixture, tradesApi } = mount([trade('a')]);
    c.openReassign(c.tradesByDay()[0]);
    fixture.detectChanges();

    c.deleteTrade('a');
    repondre(http);
    fixture.detectChanges();

    c.reassignTo({ key: c.reassignDayKey(), trades: [] } as any, 'compte-2');

    expect(tradesApi.reassign).not.toHaveBeenCalled();
    expect(c.reassignDayKey()).toBeNull();
  });

  it('succès → modale fermée même si la journée existe encore (vue tous comptes)', () => {
    const { c, fixture } = mount([trade('a')]);
    c.openReassign(c.tradesByDay()[0]);
    fixture.detectChanges();

    c.reassignTo(c.reassignDay(), 'compte-2');
    fixture.detectChanges();

    expect(
      c.reassignDayKey(),
      'Hors filtre par compte la journée subsiste : sans fermeture explicite la modale reste ouverte',
    ).toBeNull();
    expect(c.isReassigning()).toBe(false);
  });

  it('refus serveur → toast d’erreur, modale laissée ouverte pour réessayer', () => {
    const { c, fixture } = mount(
      [trade('a')],
      () => throwError(() => ({ error: { message: 'Compte cible invalide.' } })),
    );
    c.openReassign(c.tradesByDay()[0]);
    fixture.detectChanges();

    c.reassignTo(c.reassignDay(), 'compte-2');
    fixture.detectChanges();

    expect(toasts()).toEqual([{ type: 'error', message: 'Compte cible invalide.' }]);
    expect(c.reassignDayKey()).not.toBeNull();
    expect(c.isReassigning()).toBe(false);
  });

  it('succès → toast de confirmation', () => {
    const { c, fixture } = mount([trade('a'), trade('b')]);
    c.openReassign(c.tradesByDay()[0]);
    fixture.detectChanges();
    c.reassignTo(c.reassignDay(), 'compte-2');
    fixture.detectChanges();
    expect(toasts()).toEqual([{ type: 'success', message: '2 trades déplacés' }]);
  });
});
