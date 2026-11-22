import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideRouter } from '@angular/router';
import { InstallCapture } from '@app/core/install/install-capture';
import { UA, env, promptEvent } from '@app/core/install/install-test.helpers';
import { PUSH_BROWSER, type BrowserEnv } from '@app/core/push/push-browser';
import { InstallerPageComponent } from './installer-page.component';
import TEMPLATE from './installer-page.component.html?raw';

/** Page publique /installer (#1198) : VRAI template, un écran par appareil, aucune connexion requise. */
function mount(e: BrowserEnv, opts: { prompt?: boolean } = {}) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: PUSH_BROWSER, useValue: { env: () => e } }],
  });
  TestBed.overrideComponent(InstallerPageComponent, {
    set: { template: TEMPLATE, imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  TestBed.inject(InstallCapture);
  const ev = opts.prompt ? promptEvent() : null;
  if (ev) window.dispatchEvent(ev);
  const fixture = TestBed.createComponent(InstallerPageComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const title = () => el.querySelector('h1')!.textContent!.replace(/\s+/g, ' ').trim();
  return { fixture, el, q, title, ev };
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
});

describe('Page /installer : les bonnes étapes selon l’appareil', () => {
  it('iPhone Safari : 3 gestes', () => {
    const { q, title } = mount(env({ userAgent: UA.iphoneSafari }));
    expect(title()).toBe('Ajoute MTC à ton écran d\'accueil');
    expect(q('installer-ios')!.querySelectorAll('li')).toHaveLength(3);
  });

  it('iPhone Chrome : ouvrir dans Safari, avec « Copier le lien »', () => {
    const { q, title } = mount(env({ userAgent: UA.iphoneChrome }));
    expect(title()).toBe('Ouvre MyTradingCoach dans Safari pour l\'installer');
    expect(q('installer-copy')).not.toBeNull();
  });

  it('navigateur intégré (Instagram) : ouvrir dans le navigateur, nom de l’appli', () => {
    const { q, title } = mount(env({ userAgent: UA.instagram }));
    expect(title()).toBe('Ouvre dans ton navigateur');
    expect(q('installer-inapp')!.textContent).toContain('Instagram');
  });

  it('Android avec invite : « Installer » lance l’invite du navigateur', async () => {
    const { q, ev } = mount(env({ userAgent: UA.chromeAndroid }), { prompt: true });
    q('installer-install')!.click();
    await Promise.resolve();
    expect(ev!.prompt).toHaveBeenCalled();
  });

  it('Android sans invite : aide du menu ⋮', () => {
    const { q } = mount(env({ userAgent: UA.chromeAndroid }));
    expect(q('installer-android-help')!.textContent).toContain('Installer l\'application');
  });

  it('ordinateur sans invite : ouvrir la page sur le téléphone, « Copier le lien », pas d’installation ici', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const { q, title, fixture } = mount(env({ userAgent: UA.desktopFirefox, maxTouchPoints: 0 }));
    expect(title()).toBe('Installe MyTradingCoach sur ton téléphone');
    expect(q('installer-desktop-install')).toBeNull();
    q('installer-copy')!.click();
    await Promise.resolve();
    fixture.detectChanges();
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/installer`);
    expect(q('installer-copied')).not.toBeNull();
  });

  it('ordinateur avec invite : « Installer sur cet ordinateur » en plus', () => {
    const { q } = mount(env({ userAgent: UA.desktopChrome, maxTouchPoints: 0 }), { prompt: true });
    expect(q('installer-desktop-install')).not.toBeNull();
  });

  it('déjà installée : « Ouvrir MyTradingCoach »', () => {
    const { q, title } = mount(env({ standalone: true }));
    expect(title()).toBe('MyTradingCoach est déjà installé');
    expect(q('installer-open')).not.toBeNull();
  });
});
