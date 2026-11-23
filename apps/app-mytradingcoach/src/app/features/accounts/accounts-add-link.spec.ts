import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { BehaviorSubject, of } from 'rxjs';
import { Router, convertToParamMap, type ParamMap } from '@angular/router';
import { AccountsComponent } from './accounts.component';
import { AccountsApi } from '../../core/api/accounts.api';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { UserStore } from '../../core/stores/user.store';
import { ADD_ACCOUNT_PARAM, ADD_ACCOUNT_QUERY } from '../../shared/components/account-selector/add-account-link';

/**
 * « + Compte » (à côté de « Tous les comptes ») menait à /accounts sans ouvrir la modale, et le
 * bouton « Ajouter un compte » du topbar de Mes comptes faisait doublon. Le lien porte désormais
 * `?ajout=1` ; la page ouvre la modale d'ajout et retire le paramètre. Le bouton du topbar disparaît.
 */
function setup(loaded = true) {
  const store = {
    accounts: signal([]),
    selectedAccountId: signal<string | 'all'>('all'),
    isLoading: signal(false), loadError: signal(false), loaded: signal(loaded), load: vi.fn(),
  };
  const params = new BehaviorSubject<ParamMap>(convertToParamMap({}));
  // `snapshot` : lu par le retour Tradovate (ngOnInit).
  const router = { routerState: { root: { queryParamMap: params }, snapshot: { root: { queryParams: {} } } }, navigate: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: AccountsApi, useValue: { getAll: vi.fn(() => of({ data: [] })) } },
      { provide: SelectedAccountStore, useValue: store },
      { provide: UserStore, useValue: { isDemo: () => false, isPremium: () => true, maxAccounts: signal(null) } },
      { provide: Router, useValue: router },
    ],
  });
  TestBed.overrideComponent(AccountsComponent, {
    set: { template: '<div></div>', imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(AccountsComponent);
  fixture.detectChanges();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cmp = fixture.componentInstance as any;
  vi.spyOn(cmp, 'loadCatalog').mockImplementation(() => undefined);
  const arrive = (p: Record<string, string>) => {
    params.next(convertToParamMap(p));
    fixture.detectChanges();
  };
  return { cmp, store, router, arrive, fixture };
}

describe('Mes comptes · « + Compte » ouvre la modale d’ajout', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('le lien porte ?ajout=1 (la constante partagée avec la page)', () => {
    expect(ADD_ACCOUNT_QUERY).toEqual({ [ADD_ACCOUNT_PARAM]: '1' });
  });

  it('?ajout=1 → modale ouverte, paramètre retiré de l’URL sans entrée d’historique', () => {
    const { cmp, router, arrive } = setup();
    expect(cmp.formOpen()).toBe(false);
    arrive({ ajout: '1' });
    expect(cmp.formOpen()).toBe(true);
    expect(router.navigate).toHaveBeenCalledWith([], {
      queryParams: { ajout: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  });

  it('sans le paramètre (ou une autre valeur) → rien ne s’ouvre', () => {
    const { cmp, router, arrive } = setup();
    arrive({ tradovate: 'ok' });
    arrive({ ajout: '0' });
    expect(cmp.formOpen()).toBe(false);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('comptes pas encore chargés → la modale attend le chargement (quota connu)', () => {
    const { cmp, store, arrive, fixture } = setup(false);
    arrive({ ajout: '1' });
    expect(cmp.formOpen()).toBe(false);
    store.loaded.set(true);
    fixture.detectChanges();
    expect(cmp.formOpen()).toBe(true);
  });

  it('demande servie une seule fois : un rechargement des comptes ne rouvre pas la modale', () => {
    const { cmp, store, arrive, fixture } = setup();
    arrive({ ajout: '1' });
    cmp.formOpen.set(false);
    // Rechargement de la liste (après un import, par ex.) : loaded repasse par false puis true.
    store.loaded.set(false);
    fixture.detectChanges();
    store.loaded.set(true);
    fixture.detectChanges();
    expect(cmp.formOpen()).toBe(false);
  });
});

describe('templates · un seul bouton d’ajout de compte', () => {
  const app = join(import.meta.dirname, '../..');
  const selector = readFileSync(join(app, 'shared/components/account-selector/account-selector.component.html'), 'utf8');
  const accounts = readFileSync(join(app, 'features/accounts/accounts.component.html'), 'utf8');

  it('« + Compte » envoie ?ajout=1 vers /accounts', () => {
    const lien = selector.match(/<a [^>]*class="acct-add"[^>]*>/)?.[0] ?? '';
    expect(lien).toContain('routerLink="/accounts"');
    expect(lien).toContain('[queryParams]="addAccountQuery"');
  });

  it('Mes comptes : plus de bouton « Ajouter un compte » dans le topbar', () => {
    const topbar = accounts.match(/<mtc-topbar[\s\S]*?\/>/)?.[0] ?? '';
    expect(topbar).toContain('[showAccountSelector]="true"');
    expect(topbar).not.toMatch(/showAddButton|addClick|addLabel/);
  });
});
