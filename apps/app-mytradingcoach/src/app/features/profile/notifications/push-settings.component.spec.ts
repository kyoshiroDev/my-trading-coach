import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import type { TraderPushSettings } from '@mtc/shared';
import { PushApi } from '@app/core/api/push.api';
import { PUSH_BROWSER, type BrowserEnv, type PushBrowser } from '@app/core/push/push-browser';
import { AuthService } from '@app/core/auth/auth.service';
import { UserStore } from '@app/core/stores/user.store';
import { ToastService } from '@app/core/services/toast.service';
import { PushSettingsComponent, fromHhmm, toHhmm } from './push-settings.component';
import TEMPLATE from './push-settings.component.html?raw';

/** Section Notifications du profil (#666 phase 2) : VRAI template, VRAI PushService, API et navigateur simulés. */

const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';

const dev = (id: string, label = 'Chrome · Android') => ({ id, label, createdAt: '2026-10-23T10:00:00.000Z', lastSuccessAt: null });
const settings = (over: Partial<TraderPushSettings> = {}): TraderPushSettings => ({
  enabled: true, publicKey: 'BPub', mutedTypes: ['RECAP'], quietHours: null, timeZone: 'Europe/Paris',
  devices: [dev('d1'), dev('d2', 'Chrome · Windows')], ...over,
});

async function mount(opts: {
  premium?: boolean; demo?: boolean; settings?: TraderPushSettings; subscribed?: boolean; env?: Partial<BrowserEnv>;
} = {}) {
  let current = opts.settings ?? settings();
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'k', auth: 'a' } }), unsubscribe: vi.fn(async () => true) };
  const browser: PushBrowser = {
    env: () => ({ userAgent: ANDROID, maxTouchPoints: 5, standalone: false, hasServiceWorker: true, hasPushManager: true, notificationPermission: 'default', ...opts.env }),
    currentSubscription: vi.fn(async () => ((opts.subscribed ?? true) ? sub : null) as unknown as PushSubscription | null),
    subscribe: vi.fn(async () => sub as unknown as PushSubscription),
  };
  const api = {
    settings: vi.fn(async () => current),
    device: vi.fn(async () => ({ subscribed: true, id: 'd1' })),
    subscribe: vi.fn(async () => ({ subscribed: true, id: 'd1' })),
    removeDevice: vi.fn(async () => ({ removed: true })),
    preferences: vi.fn(async (input: Partial<TraderPushSettings>) => (current = { ...current, ...input })),
    test: vi.fn(async () => ({ subscriptions: 2, delivered: 2, failed: 0, removed: 0 })),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: PushApi, useValue: api },
      { provide: PUSH_BROWSER, useValue: browser },
      { provide: AuthService, useValue: { currentUser: signal({ id: 'u1' }) } },
      { provide: UserStore, useValue: { isPremium: signal(opts.premium ?? true), isDemo: signal(!!opts.demo), trialAvailable: signal(true) } },
    ],
  });
  TestBed.overrideComponent(PushSettingsComponent, {
    set: { template: TEMPLATE, imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(PushSettingsComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise((r) => setTimeout(r, 0));
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const settle = async () => { await new Promise((r) => setTimeout(r, 0)); fixture.detectChanges(); };
  return { fixture, el, q, api, browser, sub, settle, toast: TestBed.inject(ToastService) };
}

describe('Section Notifications du profil', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('Premium abonné : état actif, interrupteurs étiquetés, mentions honnêtes de délai, appareils 2 sur 10', async () => {
    const { q, el } = await mount();
    expect(q('push-active')!.textContent).toContain('Alertes actives sur cet appareil');
    const sw = q('push-type-PROP_RULES')!;
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(el.querySelector(`#${sw.getAttribute('aria-labelledby')}`)!.textContent).toContain('Limites et objectifs');
    expect(q('push-type-RECAP')!.getAttribute('aria-checked')).toBe('false'); // récap coupé par défaut
    expect(q('push-types')!.textContent).toContain('En direct si MTC est ouvert. Sinon, relevé de la synchro automatique, jusqu’à 15 min de décalage.');
    expect(q('push-types')!.textContent).toContain('Seulement en direct, pendant que MTC est ouvert.');
    expect(el.textContent).toContain('Appareils · 2 sur 10');
    expect(q('push-devices')!.textContent).toContain('CET APPAREIL');
    expect(el.textContent).not.toMatch(/[\u2013\u2014]/);
  });

  it('interrupteur : clic → réglage envoyé, état mis à jour', async () => {
    const { q, api, settle } = await mount();
    q('push-type-RECAP')!.click();
    await settle();
    expect(api.preferences).toHaveBeenCalledWith({ mutedTypes: [] }, expect.anything());
    expect(q('push-type-RECAP')!.getAttribute('aria-checked')).toBe('true');
    q('push-type-BEHAVIOR')!.click();
    await settle();
    expect(api.preferences).toHaveBeenLastCalledWith({ mutedTypes: ['BEHAVIOR'] }, expect.anything());
  });

  it('heures silencieuses : activées à 22:00-07:00, puis modifiables', async () => {
    const { q, api, settle } = await mount();
    q('push-quiet-toggle')!.click();
    await settle();
    expect(api.preferences).toHaveBeenLastCalledWith({ quietHours: { start: 1320, end: 420 } }, expect.anything());
    expect((q('push-quiet-start') as HTMLInputElement).value).toBe('22:00');
    const end = q('push-quiet-end') as HTMLInputElement;
    end.value = '06:30';
    end.dispatchEvent(new Event('change'));
    await settle();
    expect(api.preferences).toHaveBeenLastCalledWith({ quietHours: { start: 1320, end: 390 } }, expect.anything());
  });

  it('heures silencieuses : début égal à la fin refusé, message sous les champs, rien envoyé (revue I5)', async () => {
    const { q, api, settle } = await mount({ settings: settings({ quietHours: { start: 1320, end: 420 } }) });
    api.preferences.mockClear();
    const start = q('push-quiet-start') as HTMLInputElement;
    start.value = '07:00';
    start.dispatchEvent(new Event('change'));
    await settle();
    expect(api.preferences).not.toHaveBeenCalled();
    expect(q('push-quiet-error')!.textContent).toContain('Choisis deux heures différentes');
    expect(q('push-quiet-error')!.getAttribute('role')).toBe('alert');
    expect(start.value).toBe('22:00');
    // Une plage valide efface le message.
    start.value = '23:00';
    start.dispatchEvent(new Event('change'));
    await settle();
    expect(api.preferences).toHaveBeenLastCalledWith({ quietHours: { start: 1380, end: 420 } }, expect.anything());
    expect(q('push-quiet-error')).toBeNull();
  });

  it('deux interrupteurs, la 1re écriture échoue après le 2e clic : écran = serveur, un seul message (revue I1)', async () => {
    const { q, api, settle, toast } = await mount();
    const errors = vi.spyOn(toast, 'error');
    let failFirst!: (e: Error) => void;
    api.preferences.mockImplementationOnce(() => new Promise((_, reject) => { failFirst = reject; }));
    q('push-type-RECAP')!.click();
    q('push-type-BEHAVIOR')!.click();
    await settle();
    expect(q('push-type-RECAP')!.getAttribute('aria-checked')).toBe('true');
    expect(q('push-type-BEHAVIOR')!.getAttribute('aria-checked')).toBe('false');
    failFirst(new Error('500'));
    await settle();
    await settle();
    // Serveur inchangé (Récap coupé, Comportement actif) et réaffiché tel quel.
    expect(api.preferences).toHaveBeenCalledTimes(1);
    expect(q('push-type-RECAP')!.getAttribute('aria-checked')).toBe('false');
    expect(q('push-type-BEHAVIOR')!.getAttribute('aria-checked')).toBe('true');
    expect(errors).toHaveBeenCalledOnce();
  });

  it('notification test : toast « Notification envoyée, regarde ton écran »', async () => {
    const { q, settle, toast } = await mount();
    q('push-test')!.click();
    await settle();
    expect(toast.visible().map((t) => t.message)).toContain('Notification envoyée, regarde ton écran');
  });

  it('Retirer un autre appareil : appel API, cet appareil reste actif', async () => {
    const { el, api, settle, q } = await mount();
    (el.querySelectorAll('[data-testid="push-remove"]')[1] as HTMLElement).click();
    await settle();
    expect(api.removeDevice).toHaveBeenCalledWith('d2', expect.anything());
    expect(q('push-active')).not.toBeNull();
  });

  it('Gratuit : lignes Premium verrouillées et inactives, seule la reconnexion Tradovate est active, invitation Premium', async () => {
    const { q } = await mount({ premium: false });
    for (const t of ['PROP_RULES', 'BEHAVIOR', 'RECAP']) {
      expect(q(`push-type-${t}`)!.hasAttribute('disabled')).toBe(true);
      expect(q(`push-type-${t}`)!.getAttribute('aria-checked')).toBe('false');
    }
    expect(q('push-type-CONNECTION')!.hasAttribute('disabled')).toBe(false);
    expect(q('push-types')!.textContent).toContain('Premium');
    expect(q('push-types')!.textContent).toContain('Gratuit');
    expect(q('push-upsell')!.textContent).toContain('Les alertes de limite sont Premium');
    expect(q('push-quiet')).toBeNull();
  });

  it('premier réglage : bouton « Activer », interrupteurs inactifs, permission demandée seulement au clic', async () => {
    const { q, browser, settle } = await mount({ subscribed: false, settings: settings({ devices: [] }) });
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(q('push-setup')!.textContent).toContain('Reçois tes alertes de séance sur ce téléphone');
    expect(q('push-type-PROP_RULES')!.hasAttribute('disabled')).toBe(true);
    q('push-enable')!.click();
    await settle();
    expect(browser.subscribe).toHaveBeenCalledWith('BPub');
    expect(q('push-active')).not.toBeNull();
  });

  it('10 appareils : « Retire un appareil pour en ajouter un », activation bloquée', async () => {
    const devices = Array.from({ length: 10 }, (_, i) => dev(`d${i + 10}`));
    const { q } = await mount({ subscribed: false, settings: settings({ devices }) });
    expect(q('push-limit')!.textContent).toContain('Retire un appareil pour en ajouter un');
    expect(q('push-enable')!.hasAttribute('disabled')).toBe(true);
  });

  it('iPhone sans installation : aide fixe, aucun bouton', async () => {
    const { q } = await mount({ subscribed: false, env: { userAgent: IPHONE } });
    const ban = q('push-ios')!;
    expect(ban.textContent).toContain('Partager, puis Sur l’écran d’accueil, puis Ajouter');
    expect(ban.textContent).toContain('ajoute MyTradingCoach à l’écran d’accueil, puis ouvre-la depuis son icône');
    expect(ban.querySelector('button, a')).toBeNull();
    // Revue phase 2 I4 : ni durée, ni promesse que le push marchera (manifest de #715 pas encore en ligne).
    expect(ban.textContent).not.toMatch(/secondes|fonctionne|garanti/i);
  });

  it('permission refusée : étapes et « J’ai changé le réglage »', async () => {
    const { q } = await mount({ subscribed: false, env: { notificationPermission: 'denied' } });
    expect(q('push-denied')!.textContent).toContain('Notifications bloquées');
    expect(q('push-recheck')).not.toBeNull();
  });

  it('navigateur non compatible et navigateur intégré : message neutre seul', async () => {
    const a = await mount({ env: { hasPushManager: false } });
    expect(a.q('push-unsupported')!.textContent).toContain('Ton navigateur ne gère pas les notifications.');
    expect(a.q('push-types')).toBeNull();
    TestBed.resetTestingModule();
    const b = await mount({ env: { userAgent: `${IPHONE} Instagram 350.0` } });
    expect(b.q('push-in-app')!.textContent).toContain('Ouvre MyTradingCoach dans ton navigateur');
  });

  it('push coupé côté serveur : section absente, sans erreur', async () => {
    const { el, toast } = await mount({ settings: settings({ enabled: false, publicKey: null }) });
    expect(el.querySelector('[data-testid="push-settings"]')).toBeNull();
    expect(toast.visible()).toEqual([]);
  });

  it('compte démo : lecture seule, aucun bouton d’action, appareil jamais consulté', async () => {
    const { q, el, api } = await mount({ demo: true });
    expect(q('push-demo')!.textContent).toContain('aucune notification n’est envoyée');
    expect(el.querySelectorAll('[data-testid="push-remove"], [data-testid="push-test"], [data-testid="push-enable"]')).toHaveLength(0);
    for (const t of ['PROP_RULES', 'BEHAVIOR', 'RECAP', 'CONNECTION']) expect(q(`push-type-${t}`)!.hasAttribute('disabled')).toBe(true);
    expect(api.device).not.toHaveBeenCalled();
  });

  it('heures : conversions HH:MM', () => {
    expect(toHhmm(420)).toBe('07:00');
    expect(fromHhmm('22:05')).toBe(1325);
    expect(fromHhmm('25:00')).toBeNull();
  });
});
