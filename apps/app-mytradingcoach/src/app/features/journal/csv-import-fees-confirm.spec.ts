/**
 * PROMPT-197 — inciter fortement au Cash history, SANS jamais le rendre obligatoire.
 *
 * Le Cash history Tradovate donne les frais exacts ; sans lui le P&L reste brut, donc
 * optimiste. Le tag « optionnel » banalisait l'enjeu. On requalifie et on interpose une
 * confirmation douce — mais l'import doit TOUJOURS pouvoir aboutir sans le fichier :
 * bloquer créerait une barrière à l'entrée pour qui ne l'a pas sous la main.
 *
 * Ce que ces tests verrouillent, dans l'ordre d'importance :
 *  1. rien n'est jamais bloqué (canSubmit ignore les frais, « Importer quand même » passe) ;
 *  2. la confirmation apparaît quand — et seulement quand — elle a du sens ;
 *  3. l'état de décision se réinitialise entre deux lots.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CsvImportComponent } from './csv-import.component';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { SetupsStore } from '../../core/stores/setups.store';

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
  return {
    cmp: fixture.componentInstance as any,
    http: TestBed.inject(HttpTestingController),
  };
}

const csv = (name = 'perf.csv') =>
  new File(['symbol,side\n'], name, { type: 'text/csv' });

describe('Import CSV — le Cash history incite, il ne bloque jamais', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('le bouton Importer reste actif sans Cash history', () => {
    const { cmp } = mount();
    cmp.source.set('tradovate');
    cmp.selectedFile.set(csv());

    expect(
      cmp.canSubmit(),
      'Le bouton est désactivé faute de frais : ce serait une obligation déguisée',
    ).toBe(true);
  });

  it('« Importer quand même » lance bien la requête (P&L brut assumé)', () => {
    const { cmp, http } = mount();
    cmp.source.set('tradovate');
    cmp.selectedFile.set(csv());

    cmp.upload();                       // 1er clic → confirmation, pas d'appel réseau
    http.expectNone((req) => /trades\/import/.test(req.url));
    expect(cmp.showFeesConfirm()).toBe(true);

    cmp.importAnyway();                 // l'utilisateur passe outre en connaissance de cause
    expect(cmp.showFeesConfirm()).toBe(false);
    const req = http.expectOne((r) => r.url.includes('/trades/import'));
    expect(req.request.body.has('fees'), 'Aucun fichier de frais ne doit partir').toBe(false);
    expect(req.request.body.has('totalFees')).toBe(false);
    http.verify();
  });

  it('après avoir tranché, on ne redemande plus pour le même lot', () => {
    const { cmp, http } = mount();
    cmp.source.set('tradovate');
    cmp.selectedFile.set(csv());

    cmp.upload();
    cmp.importAnyway();
    http.expectOne((r) => r.url.includes('/trades/import')).flush({
      data: { created: 20, duplicates: 0, failed: 0, total: 20 },
    });

    // Un 2e envoi (retry après erreur, par ex.) ne doit pas re-poser la question :
    // il part directement en requête.
    cmp.uploading = false;
    cmp.upload();
    expect(cmp.showFeesConfirm()).toBe(false);
    http.expectOne((r) => r.url.includes('/trades/import'));
    http.verify();
  });

  it('« Ajouter le Cash history » referme sans rien importer', () => {
    const { cmp, http } = mount();
    cmp.source.set('tradovate');
    cmp.selectedFile.set(csv());

    cmp.upload();
    expect(cmp.showFeesConfirm()).toBe(true);

    cmp.addFeesFromConfirm();
    expect(cmp.showFeesConfirm()).toBe(false);
    http.expectNone((req) => /trades\/import/.test(req.url));
    http.verify();
  });
});

describe('Import CSV — la confirmation ne s\'affiche que quand elle a du sens', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('Cash history fourni → aucune confirmation, import direct', () => {
    const { cmp, http } = mount();
    cmp.source.set('tradovate');
    cmp.selectedFile.set(csv());
    cmp.feesFile.set(csv('cash.csv'));

    expect(cmp.needsFeesConfirm()).toBe(false);
    cmp.upload();
    expect(cmp.showFeesConfirm()).toBe(false);
    const req = http.expectOne((r) => r.url.includes('/trades/import'));
    expect(req.request.body.has('fees'), 'Le Cash history doit être envoyé').toBe(true);
    http.verify();
  });

  it('total des frais saisi à la main → aucune confirmation', () => {
    const { cmp, http } = mount();
    cmp.source.set('tradovate');
    cmp.selectedFile.set(csv());
    cmp.totalFees.set('21,84');

    expect(cmp.needsFeesConfirm()).toBe(false);
    cmp.upload();
    expect(cmp.showFeesConfirm()).toBe(false);
    http.expectOne((r) => r.url.includes('/trades/import'));
    http.verify();
  });

  it('autre broker → aucune confirmation (les frais sont dans le CSV)', () => {
    const { cmp, http } = mount();
    cmp.source.set('other');
    cmp.selectedFile.set(csv());

    expect(cmp.needsFeesConfirm()).toBe(false);
    cmp.upload();
    expect(cmp.showFeesConfirm()).toBe(false);
    http.expectOne((r) => r.url.includes('/trades/import'));
    http.verify();
  });
});

describe('Import CSV — la décision se réinitialise entre deux lots', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('un nouveau fichier de trades repose la question', () => {
    const { cmp, http } = mount();
    cmp.source.set('tradovate');
    cmp.selectedFile.set(csv());
    cmp.upload();
    cmp.importAnyway();
    http.expectOne((r) => r.url.includes('/trades/import')).flush({
      data: { created: 20, duplicates: 0, failed: 0, total: 20 },
    });

    cmp.reset();
    cmp.source.set('tradovate');
    cmp.selectedFile.set(csv('autre.csv'));
    cmp.uploading = false;

    cmp.upload();
    expect(
      cmp.showFeesConfirm(),
      'Sans reset, un « quand même » dispenserait tous les imports suivants',
    ).toBe(true);
    http.verify();
  });

  it('retirer le Cash history déjà joint repose la question', () => {
    const { cmp, http } = mount();
    cmp.source.set('tradovate');
    cmp.selectedFile.set(csv());
    cmp.feesFile.set(csv('cash.csv'));
    cmp.upload();                       // pas de confirmation, import direct
    http.expectOne((r) => r.url.includes('/trades/import')).flush({
      data: { created: 20, duplicates: 0, failed: 0, total: 20 },
    });

    cmp.clearFeesFile();
    cmp.uploading = false;
    cmp.upload();
    expect(cmp.showFeesConfirm()).toBe(true);
    http.verify();
  });
});
