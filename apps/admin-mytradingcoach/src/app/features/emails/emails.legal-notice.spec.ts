/**
 * Admin « Emails » : information de service « 30 jours avant » (#817). Objet et texte saisis comme
 * l'annonce, tous deux obligatoires, test obligatoire sur le contenu actuel, avertissement dédié.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EmailsComponent } from './emails.component';
import { CampaignMeta } from '../../core/api/admin.api';
import { environment } from '@admin/environments/environment';

const LEGAL = {
  type: 'legal_notice', label: 'Information de service (CGU, prix)', emoji: '⚖️', kind: 'transactional',
  requiresConsent: false, requiresTest: true, testedCurrent: false, testEmail: 'qa@test',
  targetCount: 42, newCount: 42, withConsent: 42, withoutConsent: 0, alreadyContacted: 0,
  automated: false, desc: '', targetDesc: 'Tous les comptes', sentTotal: 0, connectedWithin3d: null,
} as CampaignMeta;

describe('EmailsComponent — information de service (#817)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  function openSend() {
    const fixture = TestBed.createComponent(EmailsComponent);
    http.expectOne(`${environment.apiUrl}/admin/campaigns`).flush({ data: [LEGAL] });
    const cmp = fixture.componentInstance as any;
    cmp.openSend(LEGAL);
    fixture.detectChanges();
    return { fixture, cmp, el: fixture.nativeElement as HTMLElement };
  }

  it('saisie de l’objet et du texte, avertissement « information obligatoire »', () => {
    const { el } = openSend();
    expect(el.querySelector('#announce-subject')?.getAttribute('placeholder')).toContain('conditions générales');
    expect(el.querySelector('#announce-body')).not.toBeNull();
    expect(el.querySelector('.warning-box')?.textContent).toContain('Information obligatoire');
    expect(el.querySelector('.warning-box')?.textContent).toContain('42 comptes');
    expect(el.querySelector('.force-toggle')).toBeNull(); // test obligatoire, pas de renvoi forcé
  });

  it('envoi bloqué sans objet, sans texte ou sans test sur le contenu actuel', () => {
    const { cmp } = openSend();
    cmp.tested.set(true);
    expect(cmp.canSend()).toBe(false);
    cmp.announcementSubject.set('Évolution de nos CGU');
    expect(cmp.canSend()).toBe(false); // texte manquant
    cmp.announcementBody.set('Nos CGU changent le 1er décembre.');
    expect(cmp.canSend()).toBe(true);
    cmp.contentChanged(); // texte modifié : le test ne vaut plus
    expect(cmp.canSend()).toBe(false);
  });

  it('le test et l’envoi transmettent l’objet et le texte saisis', () => {
    const { cmp } = openSend();
    cmp.announcementSubject.set('Évolution de nos CGU');
    cmp.announcementBody.set('Texte');
    cmp.doTest();
    const test = http.expectOne(`${environment.apiUrl}/admin/campaigns/legal_notice/test`);
    expect(test.request.body).toMatchObject({ subject: 'Évolution de nos CGU', content: 'Texte' });
    test.flush({ data: { to: 'qa@test', subject: '[TEST] Évolution de nos CGU' } });
    expect(cmp.canSend()).toBe(true);

    cmp.doSend();
    const send = http.expectOne(`${environment.apiUrl}/admin/campaigns/legal_notice/send`);
    expect(send.request.body).toMatchObject({ subject: 'Évolution de nos CGU', content: 'Texte' });
    send.flush({ data: { success: 42, errors: 0, skipped: 0 } });
    http.expectOne(`${environment.apiUrl}/admin/campaigns`).flush({ data: [LEGAL] });
  });
});
