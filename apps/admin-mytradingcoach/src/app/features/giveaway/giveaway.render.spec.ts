/**
 * Admin « Tirages » (PROMPT-tirage-mensuel) : allumer passe par une confirmation qui annonce le
 * nombre d'e-mails ; éteindre n'envoie rien ; historique, modération et relance d'une attribution.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { AdminGiveawayData, AdminGiveawayWin } from '@mtc/shared';
import { GiveawayComponent } from './giveaway.component';
import { environment } from '@admin/environments/environment';

const BASE = `${environment.apiUrl}/admin/giveaway`;

const WIN: AdminGiveawayWin = {
  id: 'w1', userId: 'u1', email: 'gagnant@test.local', displayName: 'Léa M.', prizeMonths: 1,
  startsAt: '2027-02-01T08:00:00.000Z', endsAt: '2027-03-01T08:00:00.000Z',
  activationStatus: 'APPLIED', activationError: null, creditCents: null,
  displayConsent: 'PRENOM_INITIALE', message: 'Merci, ça motive !', moderation: 'EN_ATTENTE',
  instagramConsent: true, instagramHandle: 'lea', publicationStatus: 'NONE', publishedUrl: null,
};

const data = (over: Partial<AdminGiveawayData> = {}): AdminGiveawayData => ({
  free: { pool: 'FREE', enabled: false, enabledAt: null, announcedAt: null, eligibleNow: 12, announceAudience: 30 },
  premium: { pool: 'PREMIUM', enabled: true, enabledAt: '2027-01-10T10:00:00.000Z', announcedAt: '2027-01-10T10:00:00.000Z', eligibleNow: 3, announceAudience: 5 },
  nextDrawAt: '2027-03-01T08:00:00.000Z',
  manualDrawAvailable: false,
  activationAvailable: true,
  history: [
    { drawId: 'd1', period: '2027-02', pool: 'FREE', drawnAt: '2027-02-01T08:00:00.000Z', eligibleCount: 12, eligibleHash: 'h', drawnIndex: 4, win: WIN },
    { drawId: 'd2', period: '2027-02', pool: 'PREMIUM', drawnAt: '2027-02-01T08:00:00.000Z', eligibleCount: 0, eligibleHash: 'h', drawnIndex: null, win: null },
  ],
  ...over,
});

describe('GiveawayComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    // Dates du jeu de données en dur : horloge figée (règle « horloge figée » de l'agent tests).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-02-10T10:00:00Z'));
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  async function render(d = data()) {
    const fixture = TestBed.createComponent(GiveawayComponent);
    fixture.detectChanges();
    http.expectOne(BASE).flush({ data: d });
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }
  const q = (el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  it('deux interrupteurs indépendants, éligibles et état affichés', async () => {
    const { el } = await render();
    expect(q(el, 'toggle-FREE')!.getAttribute('aria-checked')).toBe('false');
    expect(q(el, 'toggle-PREMIUM')!.getAttribute('aria-checked')).toBe('true');
    expect(q(el, 'pool-FREE')!.textContent).toContain('12 éligibles');
    expect(q(el, 'draw-now-FREE')).toBeNull(); // hors prod seulement
  });

  it('allumer : confirmation avec le nombre d’e-mails, puis appel de l’API', async () => {
    const { fixture, el } = await render();
    q(el, 'toggle-FREE')!.click();
    fixture.detectChanges();
    expect(q(el, 'confirm-FREE')!.textContent).toMatch(/30\s+utilisateurs recevront un e-mail d'annonce/);
    http.expectNone(`${BASE}/settings`);
    q(el, 'confirm-yes-FREE')!.click();
    const req = http.expectOne(`${BASE}/settings`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ pool: 'FREE', enabled: true });
    req.flush({ data: { state: { ...data().free, enabled: true }, announcementsQueued: 30 } });
    http.expectOne(BASE).flush({ data: data() });
    fixture.detectChanges();
    expect(q(el, 'giveaway-notice')!.textContent).toContain("30 e-mails d'annonce");
  });

  it('éteindre : sans confirmation, rien n’est envoyé', async () => {
    const { fixture, el } = await render();
    q(el, 'toggle-PREMIUM')!.click();
    const req = http.expectOne(`${BASE}/settings`);
    expect(req.request.body).toEqual({ pool: 'PREMIUM', enabled: false });
    req.flush({ data: { state: { ...data().premium, enabled: false }, announcementsQueued: 0 } });
    http.expectOne(BASE).flush({ data: data() });
    fixture.detectChanges();
    expect(q(el, 'giveaway-notice')!.textContent).toContain('Aucun e-mail envoyé');
  });

  it('historique : gagnant, lot, tirage sans éligible (11 colonnes partout)', async () => {
    const { el } = await render();
    for (const tr of Array.from(el.querySelectorAll('tbody tr'))) {
      const cols = Array.from(tr.querySelectorAll('td')).reduce((n, td) => n + Number(td.getAttribute('colspan') ?? 1), 0);
      expect(cols).toBe(11);
    }
    const rows = q(el, 'giveaway-history')!.textContent!;
    expect(rows).toContain('gagnant@test.local');
    expect(rows).toContain('Léa M.');
    expect(rows).toContain('Aucun éligible, aucun gagnant');
  });

  it('modérer : « Valider » appelle l’API puis recharge', async () => {
    const { el } = await render();
    q(el, 'validate-w1')!.click();
    const req = http.expectOne(`${BASE}/wins/w1/moderation`);
    expect(req.request.body).toEqual({ moderation: 'VALIDE' });
    req.flush({ data: { ...WIN, moderation: 'VALIDE' } });
    http.expectOne(BASE).flush({ data: data() });
  });

  it('attribution en échec : raison et « Relancer l’attribution »', async () => {
    const failed = { ...WIN, activationStatus: 'FAILED' as const, activationError: 'Compte plus éligible' };
    const { el } = await render(data({ history: [{ ...data().history[0], win: failed }] }));
    expect(q(el, 'giveaway-history')!.textContent).toContain('Compte plus éligible');
    q(el, 'retry-w1')!.click();
    http.expectOne(`${BASE}/wins/w1/retry`).flush({ data: null });
    http.expectOne(BASE).flush({ data: data() });
  });

  it('verrou prod fermé : interrupteur éteint verrouillé avec l’explication, éteindre reste possible', async () => {
    const { el } = await render(data({ activationAvailable: false }));
    const toggle = q(el, 'toggle-FREE') as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(q(el, 'activation-locked-FREE')!.textContent).toContain('Activation en prod fermée');
    // La raison du bouton désactivé est lue par un lecteur d'écran.
    expect(toggle.getAttribute('aria-describedby')).toBe('activation-locked-FREE');
    expect(el.querySelector('#activation-locked-FREE')).not.toBeNull();
    const premium = q(el, 'toggle-PREMIUM') as HTMLButtonElement;
    expect(premium.disabled).toBe(false); // allumé : on peut l'éteindre
    expect(premium.hasAttribute('aria-describedby')).toBe(false);
    expect(q(el, 'activation-locked-PREMIUM')).toBeNull();
  });

  it('en-tête : jour et heure du tirage tirés des constantes', async () => {
    const { el } = await render();
    expect(el.querySelector('.page-meta')!.textContent).toMatch(/le 1er de chaque mois à 9\s+h/);
  });

  it('« Publier » absent sans accord Instagram ; présent avec accord et message validé', async () => {
    const { el } = await render();
    expect(q(el, 'ig-publish-w1')).toBeNull(); // WIN : accord Instagram mais message en attente
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
    const ok = { ...WIN, moderation: 'VALIDE' as const };
    const r2 = await render(data({ history: [{ ...data().history[0], win: ok }] }));
    expect(q(r2.el, 'ig-publish-w1')).not.toBeNull();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
    const noConsent = { ...ok, instagramConsent: false };
    const r3 = await render(data({ history: [{ ...data().history[0], win: noConsent }] }));
    expect(q(r3.el, 'ig-publish-w1')).toBeNull();
  });

  it('aperçu sans Metricool : « Ouvrir l’image » et « Copier la légende », pas de publication', async () => {
    const ok = { ...WIN, moderation: 'VALIDE' as const };
    const { fixture, el } = await render(data({ history: [{ ...data().history[0], win: ok }] }));
    q(el, 'ig-publish-w1')!.click();
    http.expectOne(`${BASE}/wins/w1/instagram/preview`).flush({ data: { caption: 'Bravo Léa', aiGenerated: false, imageUrl: 'https://api.test/api/public/giveaway/image/x.png', metricoolAvailable: false } });
    fixture.detectChanges();
    expect(q(el, 'ig-panel')).not.toBeNull();
    expect((q(el, 'ig-caption') as HTMLTextAreaElement).value).toBe('Bravo Léa');
    expect(q(el, 'ig-download')!.getAttribute('href')).toContain('/image/x.png');
    expect(q(el, 'ig-copy')).not.toBeNull();
    expect(q(el, 'ig-confirm')).toBeNull();
  });

  it('aperçu avec Metricool : légende modifiée envoyée à la confirmation', async () => {
    const ok = { ...WIN, moderation: 'VALIDE' as const };
    const { fixture, el } = await render(data({ history: [{ ...data().history[0], win: ok }] }));
    q(el, 'ig-publish-w1')!.click();
    http.expectOne(`${BASE}/wins/w1/instagram/preview`).flush({ data: { caption: 'Bravo', aiGenerated: true, imageUrl: 'https://api.test/i.png', metricoolAvailable: true } });
    fixture.detectChanges();
    const ta = q(el, 'ig-caption') as HTMLTextAreaElement;
    ta.value = 'Bravo Léa, bien joué';
    ta.dispatchEvent(new Event('input'));
    q(el, 'ig-confirm')!.click();
    const req = http.expectOne(`${BASE}/wins/w1/instagram/publish`);
    expect(req.request.body).toEqual({ caption: 'Bravo Léa, bien joué', imageUrl: 'https://api.test/i.png', publishAt: null });
    req.flush({ data: { publicationStatus: 'PUBLISHED', publishedUrl: null, publishedAt: '2027-02-10T10:00:00.000Z' } });
    http.expectOne(BASE).flush({ data: data() });
  });

  it('Metricool refuse à la publication : erreur dans le panneau, puis « Ouvrir l’image » et « Copier la légende »', async () => {
    const ok = { ...WIN, moderation: 'VALIDE' as const };
    const { fixture, el } = await render(data({ history: [{ ...data().history[0], win: ok }] }));
    q(el, 'ig-publish-w1')!.click();
    http.expectOne(`${BASE}/wins/w1/instagram/preview`).flush({ data: { caption: 'Bravo', aiGenerated: true, imageUrl: 'https://api.test/i.png', metricoolAvailable: true } });
    fixture.detectChanges();
    q(el, 'ig-confirm')!.click();
    http.expectOne(`${BASE}/wins/w1/instagram/publish`).flush({ message: 'Metricool : accès refusé (abonnement ou jeton).' }, { status: 502, statusText: 'Bad Gateway' });
    fixture.detectChanges();
    expect(q(el, 'ig-error')!.textContent).toContain('accès refusé');
    expect(q(el, 'ig-download')!.getAttribute('href')).toBe('https://api.test/i.png');
    expect(q(el, 'ig-copy')).not.toBeNull();
    expect(q(el, 'ig-confirm')).toBeNull();
  });

  it('heure refusée (400) : erreur affichée, formulaire gardé pour réessayer', async () => {
    const ok = { ...WIN, moderation: 'VALIDE' as const };
    const { fixture, el } = await render(data({ history: [{ ...data().history[0], win: ok }] }));
    q(el, 'ig-publish-w1')!.click();
    http.expectOne(`${BASE}/wins/w1/instagram/preview`).flush({ data: { caption: 'Bravo', aiGenerated: true, imageUrl: 'https://api.test/i.png', metricoolAvailable: true } });
    fixture.detectChanges();
    q(el, 'ig-confirm')!.click();
    http.expectOne(`${BASE}/wins/w1/instagram/publish`).flush({ message: 'Date de publication invalide.' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(q(el, 'ig-error')!.textContent).toContain('Date de publication invalide');
    expect(q(el, 'ig-confirm')).not.toBeNull();
    expect(q(el, 'ig-download')).toBeNull();
  });

  it('déjà publié (409) : message, rechargement, pas de publication manuelle', async () => {
    const ok = { ...WIN, moderation: 'VALIDE' as const };
    const { fixture, el } = await render(data({ history: [{ ...data().history[0], win: ok }] }));
    q(el, 'ig-publish-w1')!.click();
    http.expectOne(`${BASE}/wins/w1/instagram/preview`).flush({ data: { caption: 'Bravo', aiGenerated: true, imageUrl: 'https://api.test/i.png', metricoolAvailable: true } });
    fixture.detectChanges();
    q(el, 'ig-confirm')!.click();
    http.expectOne(`${BASE}/wins/w1/instagram/publish`).flush({ message: 'Ce gagnant a déjà été publié sur Instagram.' }, { status: 409, statusText: 'Conflict' });
    http.expectOne(BASE).flush({ data: data() });
    fixture.detectChanges();
    expect(q(el, 'ig-download')).toBeNull();
  });

  it('erreur de chargement : message affiché', async () => {
    const fixture = TestBed.createComponent(GiveawayComponent);
    fixture.detectChanges();
    http.expectOne(BASE).flush('boom', { status: 500, statusText: 'err' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(q(fixture.nativeElement, 'giveaway-load-error')).not.toBeNull();
  });

  it('erreur d’action : le message de l’API est affiché', async () => {
    const { fixture, el } = await render();
    q(el, 'toggle-PREMIUM')!.click();
    http.expectOne(`${BASE}/settings`).flush({ message: 'Trop de requêtes, réessaie dans une minute.' }, { status: 429, statusText: 'Too Many' });
    fixture.detectChanges();
    expect(q(el, 'giveaway-error')!.textContent).toContain('Trop de requêtes');
  });
});
