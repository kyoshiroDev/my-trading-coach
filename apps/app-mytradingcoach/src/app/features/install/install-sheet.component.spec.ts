import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { Router } from '@angular/router';
import { InstallCapture } from '@app/core/install/install-capture';
import { InstallPromptService, OPEN_DELAY_MS } from '@app/core/install/install-prompt.service';
import { UA, configureInstall, env, promptEvent } from '@app/core/install/install-test.helpers';
import { PushService } from '@app/core/push/push.service';
import type { BrowserEnv } from '@app/core/push/push-browser';
import { InstallSheetComponent, LOCK_SCREEN_EXAMPLES } from './install-sheet.component';
import TEMPLATE from './install-sheet.component.html?raw';

/** Feuille d'installation : VRAI template, VRAI InstallPromptService, navigateur et push simulés. */

async function mount(opts: {
  env?: BrowserEnv; premium?: boolean; prompt?: boolean; via?: 'offer' | 'settings' | 'push'; pushState?: string;
} = {}) {
  const ctx = configureInstall({ env: opts.env, premium: opts.premium });
  const push = { init: vi.fn(async () => undefined), state: signal(opts.pushState ?? 'supported') };
  TestBed.overrideProvider(PushService, { useValue: push });
  TestBed.overrideComponent(InstallSheetComponent, {
    set: { template: TEMPLATE, imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  TestBed.inject(InstallCapture);
  if (opts.prompt) window.dispatchEvent(promptEvent());
  const router = TestBed.inject(Router);
  await router.navigateByUrl('/dashboard');
  const service = TestBed.inject(InstallPromptService);
  if (opts.via === 'push') service.sheet.set('push');
  else if (opts.via === 'offer') {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    service.offer(opts.premium ? 'plan-linked' : 'import');
    vi.advanceTimersByTime(OPEN_DELAY_MS);
    vi.useRealTimers();
  } else service.openFromSettings();
  const fixture = TestBed.createComponent(InstallSheetComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const text = () => (el.textContent ?? '').replace(/\s+/g, ' ');
  return { ...ctx, fixture, el, q, text, service, push, router };
}

afterEach(() => TestBed.resetTestingModule());

describe('Feuille d’installation : un écran par appareil', () => {
  it('Android avec invite : écran verrouillé aux 3 vraies notifications, « Installer », ligne Gratuit', async () => {
    const { q, el, text } = await mount({ prompt: true });
    expect(q('install-main')).not.toBeNull();
    expect(text()).toContain('Tes alertes, sur ton écran verrouillé');
    const notifs = [...el.querySelectorAll('.is-notif b')].map((b) => b.textContent);
    expect(notifs).toEqual(LOCK_SCREEN_EXAMPLES.map((n) => n.text));
    expect(q('install-prompt')!.textContent).toContain('Installer');
    expect(q('install-upsell')!.textContent!.replace(/\u00a0/g, ' ')).toBe(
      "Alertes de limite et récap : Premium. Prévenir quand ta synchro s'arrête : gratuit.",
    );
  });

  it('Premium : pas de ligne de gating', async () => {
    const { q } = await mount({ prompt: true, premium: true });
    expect(q('install-main')).not.toBeNull();
    expect(q('install-upsell')).toBeNull();
  });

  it('Android sans invite : aide du menu, pas de bouton « Installer »', async () => {
    const { q } = await mount();
    expect(q('install-prompt')).toBeNull();
    expect(q('install-android-help')!.textContent).toContain('Installer l');
  });

  it('iPhone Safari : trois étapes, flèche vers Partager, « Ne plus me proposer » (proposition automatique)', async () => {
    const { q, el, text } = await mount({ env: env({ userAgent: UA.iphoneSafari }), via: 'offer' });
    expect(q('install-ios')).not.toBeNull();
    expect(el.querySelectorAll('.is-steps li')).toHaveLength(3);
    expect(el.querySelector('.is-arrow')).not.toBeNull();
    expect(text()).toContain('Ne plus me proposer');
  });

  it('iPhone Safari, « Je l’ai fait » hors mode app : « ouvre MTC depuis son icône »', async () => {
    const { q, fixture } = await mount({ env: env({ userAgent: UA.iphoneSafari }) });
    q('install-ios-done')!.click();
    fixture.detectChanges();
    expect(q('install-ios-open-icon')).not.toBeNull();
  });

  it('ouverte depuis le Profil : pas de « Ne plus me proposer »', async () => {
    const { text } = await mount({ env: env({ userAgent: UA.iphoneSafari }), via: 'settings' });
    expect(text()).not.toContain('Ne plus me proposer');
  });

  it('iPhone sur Chrome : « Ouvre MyTradingCoach dans Safari pour l’installer »', async () => {
    const { q } = await mount({ env: env({ userAgent: UA.iphoneChrome }) });
    expect(q('install-ios-other')!.textContent).toContain("Ouvre MyTradingCoach dans Safari pour l'installer");
  });

  it('navigateur intégré : uniquement « Ouvre dans ton navigateur », rien d’autre', async () => {
    const { q, el, text } = await mount({ env: env({ userAgent: UA.instagram }), via: 'offer' });
    expect(q('install-inapp')).not.toBeNull();
    expect(text()).toContain('Pour installer MTC, il faut quitter Instagram.');
    expect(el.querySelector('.is-lock, .is-steps, [data-testid="install-prompt"]')).toBeNull();
    expect(text()).not.toContain('Ne plus me proposer');
  });
});

describe('Feuille d’invitation aux alertes (après installation)', () => {
  it('push ouvert côté serveur : explication, délai annoncé, lien vers Profil#notifications', async () => {
    const { q, text, router, service } = await mount({ env: env({ standalone: true }), via: 'push' });
    expect(q('install-push')).not.toBeNull();
    expect(text().replace(/\u00a0/g, ' ')).toContain("jusqu'à 15 min de décalage");
    const nav = vi.spyOn(router, 'navigate');
    q('install-push-go')!.click();
    expect(nav).toHaveBeenCalledWith(['/profil'], { fragment: 'notifications' });
    expect(service.sheet()).toBeNull();
  });

  it.each(['server-disabled', 'denied', 'unsupported', 'subscribed'])('push %s : rien affiché, feuille fermée', async (st) => {
    const { q, service, store } = await mount({ env: env({ standalone: true }), via: 'push', pushState: st });
    expect(q('install-push')).toBeNull();
    expect(service.sheet()).toBeNull();
    expect(store.storage.isNever('push')).toBe(st === 'subscribed');
  });
});

describe('Textes de la feuille', () => {
  const visible = TEMPLATE.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\{\{[^}]*\}\}/g, ' ').replace(/@[a-z]+[^{]*\{|\}/g, ' ');
  it('aucun tiret cadratin, espace insécable avant : ; ! ? %', () => {
    expect(TEMPLATE).not.toContain('—');
    expect(visible).not.toMatch(/ [:;!?%]/);
    for (const n of LOCK_SCREEN_EXAMPLES) expect(n.text).not.toMatch(/ [:;!?%]/);
  });
  it('notifications d’exemple sans montant', () => {
    for (const n of LOCK_SCREEN_EXAMPLES) expect(n.text).not.toMatch(/[$€]|\d[\d\s]*\s?(USD|EUR)/);
  });
});
