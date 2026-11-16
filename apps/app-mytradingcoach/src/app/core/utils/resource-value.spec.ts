/**
 * F1 (#1047) : en Angular 22, `resource.value()` LÈVE (ResourceValueError) quand la requête a
 * échoué. Les `computed` des Statistiques et du tableau de bord le lisaient sans `hasValue()` : une
 * route en 500 ou 403 faisait planter le rendu malgré le bloc « Réessayer ».
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient, httpResource } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { resourceValue } from './resource-value';

describe('resourceValue', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  });

  async function resourceAfter(flush: (http: HttpTestingController) => void) {
    const res = TestBed.runInInjectionContext(() => httpResource<{ data: number }>(() => '/api/x'));
    TestBed.tick();
    flush(TestBed.inject(HttpTestingController));
    await new Promise((r) => setTimeout(r, 0));
    return res;
  }

  it('requête en erreur : value() lève, resourceValue renvoie undefined', async () => {
    const res = await resourceAfter((http) =>
      http.expectOne('/api/x').flush('boom', { status: 500, statusText: 'Server Error' }),
    );
    expect(() => res.value()).toThrow();
    expect(resourceValue(res)).toBeUndefined();
  });

  it('requête réussie : la valeur', async () => {
    const res = await resourceAfter((http) => http.expectOne('/api/x').flush({ data: 42 }));
    expect(resourceValue(res)).toEqual({ data: 42 });
  });
});
