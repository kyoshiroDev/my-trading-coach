/**
 * « fichier vide » et « mauvais format » ne sont pas le même problème.
 *
 * Cas réel (Val) : un export Tradovate raté produit un fichier de 9 octets contenant
 * littéralement `undefined`. Le message générique « ce fichier ne ressemble pas à un
 * Cash history » envoyait alors chercher le bon fichier — alors que le bon fichier
 * n'existe pas : c'est l'export côté broker qu'il faut refaire. Deux diagnostics, deux
 * actions, donc deux messages.
 *
 * Les contenus testés viennent des fichiers réels du dossier `test/` du dépôt :
 * l'en-tête Cash History authentique, et le `undefined` de `test/csv vide/`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { CsvImportComponent } from './csv-import.component';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { SetupsStore } from '../../core/stores/setups.store';

/** En-tête réel de `test/Cash History.csv`. */
const CASH_HISTORY =
  'Account,Transaction ID,Timestamp,Date,Delta,Amount,Cash Change Type,Currency,Contract\n' +
  'APEX-1,12345,2026-07-10T14:00:00,10/07/2026,-1.04,998.96,Commission,USD,MNQU6';

/** Export Tradovate raté, verbatim : `test/csv vide/Cash History (1).csv`, 9 octets. */
const EXPORT_RATE = 'undefined';

/** Mauvais fichier mais CSV valide : Performance à la place du Cash history. */
const PERFORMANCE =
  'symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration\n' +
  'MNQU6,2,Decimal,0.25,B1,S1,1,18500,18540,$80.00,07/10/2026 09:31:05,07/10/2026 09:31:47,00:00:42';

function mount() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SetupsStore, useValue: { active: signal([]), load: vi.fn(), loaded: signal(true) } },
      {
        provide: SelectedAccountStore,
        useValue: {
          activeAccounts: signal([]), selectedAccountId: signal('all'),
          load: vi.fn(), loaded: signal(true),
        },
      },
    ],
  });
  TestBed.overrideComponent(CsvImportComponent, {
    set: {
      template: '<div></div>', imports: [], styleUrls: [],
      styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const fixture = TestBed.createComponent(CsvImportComponent);
  fixture.detectChanges();
  return fixture.componentInstance as any;
}

/**
 * Joue `onFeesFileChange` avec un contenu donné. `FileReader` est asynchrone : on attend
 * que le composant ait tranché plutôt que de supposer un délai.
 */
async function choisirFichierFrais(cmp: any, contenu: string, nom = 'cash.csv') {
  const file = new File([contenu], nom, { type: 'text/csv' });
  cmp.onFeesFileChange({ target: { files: [file] } } as unknown as Event);
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 10));
    if (cmp.feesFileEmpty() || cmp.feesFileValid()) return;
  }
}

describe('Import CSV — fichier de frais vide vs mauvais format', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('export Tradovate raté (« undefined », 9 octets) → signalé comme vide', async () => {
    const cmp = mount();

    await choisirFichierFrais(cmp, EXPORT_RATE);

    expect(cmp.feesFileEmpty(), 'Le cas Val doit être diagnostiqué « vide »').toBe(true);
    expect(
      cmp.feesFileValid(),
      'Un fichier vide ne doit surtout pas passer pour un Cash history valide',
    ).toBe(false);
  });

  it('fichier de 0 octet → signalé comme vide', async () => {
    const cmp = mount();

    await choisirFichierFrais(cmp, '');

    expect(cmp.feesFileEmpty()).toBe(true);
  });

  it('mauvais fichier mais CSV structuré (Performance) → message générique, pas « vide »', async () => {
    const cmp = mount();

    await choisirFichierFrais(cmp, PERFORMANCE, 'Performance.csv');

    expect(
      cmp.feesFileEmpty(),
      'Un vrai CSV au mauvais format n\'est pas vide : le diagnostic serait faux',
    ).toBe(false);
    expect(cmp.feesFileValid()).toBe(false);
  });

  it('Cash history authentique → aucun message, comportement inchangé', async () => {
    const cmp = mount();

    await choisirFichierFrais(cmp, CASH_HISTORY);

    expect(cmp.feesFileValid()).toBe(true);
    expect(cmp.feesFileEmpty()).toBe(false);
  });

  it('retirer le fichier remet les deux signaux à zéro', async () => {
    const cmp = mount();
    await choisirFichierFrais(cmp, EXPORT_RATE);
    expect(cmp.feesFileEmpty()).toBe(true);

    cmp.clearFeesFile();

    expect(cmp.feesFileEmpty()).toBe(false);
    expect(cmp.feesFileValid()).toBe(false);
    expect(cmp.feesFile()).toBeNull();
  });

  it('un second fichier valide efface le diagnostic du précédent', async () => {
    const cmp = mount();
    await choisirFichierFrais(cmp, EXPORT_RATE);
    expect(cmp.feesFileEmpty()).toBe(true);

    await choisirFichierFrais(cmp, CASH_HISTORY);

    expect(
      cmp.feesFileEmpty(),
      'Le message « vide » persiste alors que le nouveau fichier est bon',
    ).toBe(false);
    expect(cmp.feesFileValid()).toBe(true);
  });
});
