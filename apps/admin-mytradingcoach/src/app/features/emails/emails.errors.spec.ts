/**
 * A19 (#1065) : un aperçu en erreur affichait « 0 destinataire » (comme si personne n'était ciblé),
 * une liste de campagnes en erreur affichait « Aucune campagne ».
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EmailsComponent } from './emails.component';
import { CampaignMeta } from '../../core/api/admin.api';
import { environment } from '@admin/environments/environment';

const ANNOUNCEMENT = { type: 'announcement', label: 'Annonce', emoji: '📣' } as CampaignMeta;
const LIST_URL = `${environment.apiUrl}/admin/campaigns`;

describe('EmailsComponent — erreurs (A19 #1065)', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { http.verify(); vi.useRealTimers(); });

  it('liste en erreur : message et Réessayer, jamais « Aucune campagne »', async () => {
    const fixture = TestBed.createComponent(EmailsComponent);
    http.expectOne(LIST_URL).flush({}, { status: 500, statusText: 'Error' });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('Aucune campagne');
    (el.querySelector('[data-testid="error-state-retry"]') as HTMLButtonElement).click();
    http.expectOne(LIST_URL).flush({ data: [ANNOUNCEMENT] });
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="error-state"]')).toBeNull();
  });

  it('aperçu en erreur : message, jamais « 0 destinataire »', async () => {
    const fixture = TestBed.createComponent(EmailsComponent);
    http.expectOne(LIST_URL).flush({ data: [ANNOUNCEMENT] });
    (fixture.componentInstance as unknown as { openPreview(c: CampaignMeta): void }).openPreview(ANNOUNCEMENT);
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne(`${LIST_URL}/announcement/preview`).flush({}, { status: 500, statusText: 'Error' });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('0 destinataire');
    expect(el.querySelector('[data-testid="preview-error"]')).not.toBeNull();
  });
});
