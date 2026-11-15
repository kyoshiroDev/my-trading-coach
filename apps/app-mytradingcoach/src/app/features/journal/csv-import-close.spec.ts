/**
 * Audit fonctionnel #994 (lot 1c, F5) : depuis le journal et le dashboard, la modale se fermait dès
 * l'import fini (récap doublons / lignes rejetées / frais non rapprochés jamais vu), puis se rouvrait
 * sur l'ancien résultat. Elle reste ouverte sur le récap ; la fermer la remet à zéro.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
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
  return fixture.componentInstance as any;
}

const OK_RESULT = { created: 20, duplicates: 3, failed: 1, total: 24 };

describe('CsvImportComponent — fermeture et réouverture', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('fermer après un import : résultat et erreur effacés, la prochaine ouverture repart à zéro', () => {
    const cmp = mount();
    const dismissed = vi.fn();
    cmp.dismissed.subscribe(dismissed);
    cmp.result.set(OK_RESULT);
    cmp.error.set('ancienne erreur');

    cmp.close();

    expect(dismissed).toHaveBeenCalledTimes(1);
    expect(cmp.result()).toBeNull();
    expect(cmp.error()).toBeNull();
  });

  it('clic sur le fond : même fermeture', () => {
    const cmp = mount();
    cmp.result.set(OK_RESULT);
    const overlay = document.createElement('div');
    overlay.classList.add('overlay');
    cmp.onOverlayClick({ target: overlay } as unknown as MouseEvent);
    expect(cmp.result()).toBeNull();
  });
});
