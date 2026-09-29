import { afterEach, beforeEach } from 'vitest';
import { getTestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';

// Les specs partagent leurs modules dans un même worker (isolate: false, voir
// vitest.config.mts) : ce fichier est rejoué pour chaque spec, alors que
// @angular/core/testing n'est chargé qu'une fois.
const testBed = getTestBed();
if (!testBed.platform) {
  testBed.initTestEnvironment(
    BrowserTestingModule,
    platformBrowserTesting(),
    {
      errorOnUnknownElements: true,
      errorOnUnknownProperties: true,
    },
  );
}

// Angular n'enregistre son reset automatique qu'au premier chargement du module :
// on le réenregistre pour chaque spec, sinon un TestBed déjà instancié fuit vers la suivante.
beforeEach(() => testBed.resetTestingModule());
afterEach(() => testBed.resetTestingModule());
