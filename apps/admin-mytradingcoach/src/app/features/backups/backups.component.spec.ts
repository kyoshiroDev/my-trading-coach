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

  // A16 (#1065) : cibles « Config API » toujours refusées (400) ; erreurs muettes ; une erreur de
  // chargement déclenchait la fausse alerte « Aucune sauvegarde trouvée ».
  it('A16 : pas de cible Config API dans « Nouveau backup »', async () => {
    const { el, fixture } = await render();
    (el.querySelector('.btn-primary') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[role="dialog"]')!.textContent).not.toContain('Config API');
  });

  it('A16 : chargement en échec, état « indisponible » et Réessayer, jamais « Aucune sauvegarde »', async () => {
    const { el } = await render('error');
    expect(el.textContent).not.toContain('Aucune sauvegarde trouvée');
    expect(el.querySelector('[data-testid="error-state"]')).not.toBeNull();
  });

  it('A16 : suppression en échec, message ; double clic, une seule requête', async () => {
    const { el, fixture } = await render();
    (el.querySelector('[aria-label="Supprimer"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const confirmBtn = el.querySelector('[role="dialog"] .btn-danger') as HTMLButtonElement;
    confirmBtn.click();
    fixture.detectChanges();
    confirmBtn.click();
    const reqs = http.match((r) => r.method === 'DELETE');
    expect(reqs.length).toBe(1);
    reqs[0].flush({ message: 'Fichier introuvable sur le serveur' }, { status: 500, statusText: 'Error' });
    fixture.detectChanges();
    // 500 : message de repli de l'écran (apiErrorMessage ne relaie pas un 500 générique).
    expect(el.querySelector('[data-testid="backup-error"]')?.textContent).toContain('La suppression a échoué');
  });

  it('A16 : backup manuel en échec, message affiché', async () => {
    const { el, fixture } = await render();
    (el.querySelector('.btn-primary') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('.target-card') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('[role="dialog"] .modal-footer .btn-primary') as HTMLButtonElement).click();
    http.expectOne((r) => r.method === 'POST').flush({ message: 'Sauvegarde déjà en cours' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="backup-error"]')?.textContent).toContain('Sauvegarde déjà en cours');
  });
});
