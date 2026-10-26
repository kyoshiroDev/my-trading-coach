import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InstallCapture } from '@app/core/install/install-capture';
import { InstallPromptService } from '@app/core/install/install-prompt.service';
import { UA, configureInstall, env, promptEvent } from '@app/core/install/install-test.helpers';
import type { BrowserEnv } from '@app/core/push/push-browser';
import { InstallSettingsComponent } from './install-settings.component';
import TEMPLATE from './install-settings.component.html?raw';

/** Ligne « Installer l'app » du Profil (maquette n° 5) : point d'entrée permanent. */

function mount(e: BrowserEnv, prompt = false) {
  configureInstall({ env: e });
  TestBed.overrideComponent(InstallSettingsComponent, {
    set: { template: TEMPLATE, styleUrls: [], styleUrl: undefined as unknown as string },
  });
  TestBed.inject(InstallCapture);
  if (prompt) window.dispatchEvent(promptEvent());
  const fixture = TestBed.createComponent(InstallSettingsComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { el, q: (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null, service: TestBed.inject(InstallPromptService) };
}

afterEach(() => TestBed.resetTestingModule());

describe('Profil : ligne « Installer l’app »', () => {
  it('iPhone Safari : la ligne rouvre le parcours, même après « Ne plus me proposer »', () => {
    const { q, service } = mount(env({ userAgent: UA.iphoneSafari }));
    service.never();
    q('install-settings-open')!.click();
    expect(service.sheet()).toBe('install');
    expect(service.fromSettings()).toBe(true);
  });

  it('installée : « App installée », ACTIVE, aucun bouton', () => {
    const { q } = mount(env({ userAgent: UA.iphoneSafari, standalone: true }));
    expect(q('install-settings-installed')!.textContent).toContain('App installée');
    expect(q('install-settings-installed')!.textContent).toContain('ACTIVE');
    expect(q('install-settings-open')).toBeNull();
  });

  it('ordinateur sans invite du navigateur : aucune ligne ; avec invite : la ligne', () => {
    expect(mount(env({ userAgent: UA.desktopFirefox, maxTouchPoints: 0 })).q('install-settings')).toBeNull();
    TestBed.resetTestingModule();
    expect(mount(env({ userAgent: UA.desktopChrome, maxTouchPoints: 0 }), true).q('install-settings-open')).not.toBeNull();
  });

  it('placée dans l’onglet Paramètres du Profil, juste avant la section Notifications', () => {
    const html = readFileSync(join(__dirname, '../profile/profile.component.html'), 'utf-8');
    const row = html.indexOf('<mtc-install-settings />');
    expect(row).toBeGreaterThan(html.indexOf("@if (activeProfileTab() === 'params')"));
    expect(row).toBeLessThan(html.indexOf('<mtc-push-settings />'));
  });
});
