import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { JournalComponent } from './journal.component';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { CreateTradeDto } from '../../core/api/trades.api';
import { environment } from '../../../environments/environment';

const DTO: CreateTradeDto = {
  asset: 'BTC/USDT', side: 'LONG', emotion: 'NEUTRAL',
  setupId: 's1', session: 'NEW_YORK', timeframe: '5m',
};
const TRADE_RES = { data: { ...DTO, id: 't1', tags: [], tradedAt: '', createdAt: '' } };

function setup(accountParam: string | undefined) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SelectedAccountStore, useValue: { accountParam: () => accountParam } },
    ],
  });
  TestBed.overrideComponent(JournalComponent, {
    set: { imports: [], template: '<div></div>', styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(JournalComponent);
  fixture.detectChanges();
  const http = TestBed.inject(HttpTestingController);
  // L'effect de chargement initial part au démarrage → on l'absorbe (la query est
  // embarquée dans l'URL, donc on matche par préfixe).
  http.match((r) => r.method === 'GET' && r.url.startsWith(`${environment.apiUrl}/trades`))
    .forEach((r) => r.flush({ data: { data: [], nextCursor: null, hasNextPage: false } }));
  // Le store setups charge aussi au démarrage (GET /setups) → on l'absorbe.
  http.match((r) => r.method === 'GET' && r.url.startsWith(`${environment.apiUrl}/setups`))
    .forEach((r) => r.flush({ data: [] }));

  return { cmp: fixture.componentInstance as any, http };
}

describe('JournalComponent — trade créé sur le compte sélectionné', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('compte sélectionné → POST /trades inclut accountId', () => {
    const { cmp, http } = setup('acc1');
    cmp.submitTrade({ ...DTO });
    const req = http.expectOne(`${environment.apiUrl}/trades`);
    expect(req.request.body.accountId).toBe('acc1');
    req.flush(TRADE_RES);
  });

  it('« Tous les comptes » → POST /trades sans accountId (fallback backend)', () => {
    const { cmp, http } = setup(undefined);
    cmp.submitTrade({ ...DTO });
    const req = http.expectOne(`${environment.apiUrl}/trades`);
    expect(req.request.body.accountId).toBeUndefined();
    req.flush(TRADE_RES);
  });
});