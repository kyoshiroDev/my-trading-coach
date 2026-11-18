import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BackupsComponent } from './backups.component';
import { environment } from '@admin/environments/environment';

const URL = `${environment.apiUrl}/vps/backups`;
const backup = (filename: string, target = 'bdd_prod') => ({
  filename, sizeMb: 12.3, createdAt: new Date().toISOString(), type: 'auto', target,
});

describe('BackupsComponent', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  async function render(list: 'error' | object[] = [backup('prod-1.sql.gz')]) {
    const fixture = TestBed.createComponent(BackupsComponent);
    fixture.detectChanges();
    const req = http.expectOne(URL);
    if (list === 'error') req.flush({}, { status: 500, statusText: 'Error' }); else req.flush({ data: list });
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  // A15 (#1065) : « Restaurer » appelait une route inexistante (404 avalé). Décision du 16/11 :
  // bouton retiré, restauration manuelle sur le serveur.
  it('A15 : aucun bouton Restaurer, mention de la restauration manuelle', async () => {
    const { el } = await render();
    expect(el.querySelector('[aria-label="Restaurer"]')).toBeNull();
    expect(el.textContent).toContain('Restauration manuelle sur le serveur');
  });
});
