/**
 * Admin « Comptes supprimés » — état vide de la carte « Motifs de départ ».
 *
 * Constaté en prod après avoir vidé la table `DeletedAccount` : la liste
 * affichait bien « Aucun compte supprimé », mais la carte des motifs restait
 * entièrement blanche — Chart.js dessine un donut sans secteur, donc rien du tout.
 * Résultat : un bloc qui se lit comme cassé, là où les autres zones annoncent
 * explicitement l'absence de données.
 *
 * `byReason` n'est vide QUE si la table l'est : un motif nul devient « Non renseigné »,
 * qui reste une entrée du regroupement (cf. `deleted-account.service.ts`). Les deux
 * états vides désignent donc la même réalité, d'où le même libellé.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DeletedComponent } from './deleted.component';
import { DeletedAccountsData } from '../../core/api/admin.api';
import { environment } from '@admin/environments/environment';

const MOIS = ['Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août'];

/** Table vide : ce que renvoie le back quand plus aucune suppression n'est tracée. */
function donneesVides(): DeletedAccountsData {
  return {
    accounts: [],
    stats: { thisMonth: 0, total: 0, medianLifetimeDays: 0, noTradePct: 0, noTradeCount: 0 },
    byMonth: MOIS.map((month) => ({ month, count: 0 })),
    byReason: [],
  } as unknown as DeletedAccountsData;
}

function donneesAvecMotifs(): DeletedAccountsData {
  return {
    accounts: [
      {
        id: 'a1', name: 'test', email: 'test@example.com',
        signedUpAt: '2026-06-17T03:21:00.000Z', deletedAt: '2026-06-17T03:31:00.000Z',
        lifetimeDays: 0, plan: 'FREE', hadTraded: false, tradesCount: 0,
        referredBy: null, deletedBy: 'self', reason: 'Trop cher', anonymizedAt: null,
      },
    ],
    stats: { thisMonth: 0, total: 1, medianLifetimeDays: 0, noTradePct: 100, noTradeCount: 1 },
    byMonth: MOIS.map((month) => ({ month, count: month === 'Juin' ? 1 : 0 })),
    byReason: [{ reason: 'Trop cher', count: 1 }],
  } as unknown as DeletedAccountsData;
}

async function rendre(data: DeletedAccountsData) {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(DeletedComponent);
  fixture.detectChanges();
  const httpMock = TestBed.inject(HttpTestingController);
  httpMock.expectOne(`${environment.apiUrl}/admin/deleted-accounts`).flush({ data });
  await fixture.whenStable();
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, text: el.textContent ?? '' };
}

describe('Comptes supprimés — carte « Motifs de départ » sans données', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('table vide → message d\'état vide au lieu d\'une carte blanche', async () => {
    const { el } = await rendre(donneesVides());

    const vide = el.querySelector('[data-testid="reason-empty"]');
    expect(
      vide,
      'La carte des motifs reste entièrement blanche : elle se lit comme un bloc cassé',
    ).toBeTruthy();
    expect(vide?.textContent?.trim()).toBe('Aucun compte supprimé');
  });

  it('table vide → le donut n\'est pas rendu du tout', async () => {
    // Laisser le canvas en place afficherait un graphique sans secteur : c'est
    // exactement ce qu'on veut supprimer, pas seulement masquer.
    const { el } = await rendre(donneesVides());

    const carteMotifs = [...el.querySelectorAll('.card')].find((c) =>
      c.textContent?.includes('Motifs de départ'),
    );
    expect(carteMotifs).toBeTruthy();
    expect(carteMotifs?.querySelector('mtc-admin-chart')).toBeNull();
  });

  it('le libellé est le même que celui de la liste (une seule réalité décrite)', async () => {
    const { el, text } = await rendre(donneesVides());

    expect(text).toContain('Aucun compte supprimé');
    // Présent aux deux endroits : la liste ET la carte des motifs.
    expect(
      [...el.querySelectorAll('.empty')].filter(
        (e) => e.textContent?.trim() === 'Aucun compte supprimé',
      ).length,
    ).toBe(2);
  });

  it('avec des motifs → le donut est rendu, aucun état vide (non-régression)', async () => {
    const { el } = await rendre(donneesAvecMotifs());

    const carteMotifs = [...el.querySelectorAll('.card')].find((c) =>
      c.textContent?.includes('Motifs de départ'),
    );
    expect(carteMotifs?.querySelector('mtc-admin-chart')).toBeTruthy();
    expect(el.querySelector('[data-testid="reason-empty"]')).toBeNull();
  });

  it('les autres cartes ne sont pas touchées par le cas vide', async () => {
    // Le graphe mensuel garde ses 6 mois à zéro : une série temporelle vide reste
    // lisible, contrairement au donut. On vérifie qu'on ne l'a pas masqué au passage.
    const { el, text } = await rendre(donneesVides());

    const carteMois = [...el.querySelectorAll('.card')].find((c) =>
      c.textContent?.includes('Suppressions par mois'),
    );
    expect(carteMois?.querySelector('mtc-admin-chart')).toBeTruthy();
    expect(text).toContain('Total supprimés');
  });
});
