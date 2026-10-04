/**
 * Admin « Emails » : l'aperçu affiche le HTML rendu par l'API (le vrai template envoyé), pour
 * tous les types. Avant : l'annonce était reconstruite côté front, avec un design différent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EmailsComponent } from './emails.component';
import { CampaignMeta } from '../../core/api/admin.api';
import { environment } from '@admin/environments/environment';

const ANNOUNCEMENT = { type: 'announcement', label: 'Annonce', emoji: '📣' } as CampaignMeta;
const PREVIEW_URL = `${environment.apiUrl}/admin/campaigns/announcement/preview`;

describe('EmailsComponent — aperçu', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  function setup() {
    const fixture = TestBed.createComponent(EmailsComponent);
    http.expectOne(`${environment.apiUrl}/admin/campaigns`).flush({ data: [ANNOUNCEMENT] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cmp = fixture.componentInstance as any;
    return { fixture, cmp };
  }

  it("annonce : l'iframe reçoit le HTML du serveur, pas une reconstruction front", async () => {
    const { fixture, cmp } = setup();
    cmp.openPreview(ANNOUNCEMENT);
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne(PREVIEW_URL).flush({ data: { html: '<p id="srv">rendu serveur</p>', recipients: [] } });
    fixture.detectChanges();

    const iframe = (fixture.nativeElement as HTMLElement).querySelector('iframe')!;
    expect(iframe.getAttribute('srcdoc')).toBe('<p id="srv">rendu serveur</p>');
  });

  it('frappe : un seul appel après la pause, avec le dernier objet saisi', async () => {
    const { cmp } = setup();
    cmp.openPreview(ANNOUNCEMENT);
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne(PREVIEW_URL).flush({ data: { html: 'v1', recipients: [] } });

    for (const subject of ['N', 'No', 'Nouveau']) {
      cmp.announcementSubject.set(subject);
      cmp.refreshPreview();
      await vi.advanceTimersByTimeAsync(100);
    }
    http.expectNone(PREVIEW_URL);

    await vi.advanceTimersByTimeAsync(400);
    const req = http.expectOne(PREVIEW_URL);
    expect(req.request.body.subject).toBe('Nouveau');
    req.flush({ data: { html: 'v2', recipients: [] } });
    expect(cmp.previewHtml()).toBe('v2');
  });
});
