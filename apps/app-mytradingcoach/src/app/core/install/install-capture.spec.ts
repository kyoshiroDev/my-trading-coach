import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { InstallCapture } from './install-capture';
import { configureInstall, memoryStorage, promptEvent } from './install-test.helpers';

/**
 * Événements du navigateur reçus AVANT le chargement du parcours (fichier à la demande, budget du
 * bundle) : `InstallCapture`, dans le bundle initial, les garde pour le service.
 * Contre-épreuve : sans l'écouteur correspondant dans `InstallCapture`, chaque test échoue.
 */
afterEach(() => TestBed.resetTestingModule());

describe('InstallCapture : événements reçus avant le chargement du parcours', () => {
  it('beforeinstallprompt gardé, transmis au service, « Installer » ouvre l’invite du navigateur', async () => {
    const { events } = configureInstall();
    const capture = TestBed.inject(InstallCapture); // créé au démarrage par App
    const e = promptEvent('accepted');

    window.dispatchEvent(e);

    expect(e.defaultPrevented).toBe(true); // pas la barre de Chrome à l'arrivée
    const service = await capture.load(); // le parcours arrive après l'événement
    expect(service.state()).toBe('can-prompt');
    service.openFromSettings();
    await service.install();
    expect(e.prompt).toHaveBeenCalledOnce();
    expect(events.track).toHaveBeenCalledWith('install_click', 'android');
    expect(service.sheet()).toBeNull(); // installation acceptée : feuille fermée
  });

  it('appinstalled avant le chargement : install_done envoyé une seule fois', async () => {
    const store = memoryStorage();
    const { events } = configureInstall({ store });
    const capture = TestBed.inject(InstallCapture);

    window.dispatchEvent(new Event('appinstalled'));

    await vi.waitFor(() => expect(events.track).toHaveBeenCalledWith('install_done', 'android'));
    // Deuxième confirmation, nouveau chargement du service : toujours une seule fois par appareil.
    window.dispatchEvent(new Event('appinstalled'));
    await capture.load();
    await new Promise((r) => setTimeout(r, 0));
    expect(events.track.mock.calls.filter(([ev]) => ev === 'install_done')).toHaveLength(1);
    expect(store.local.get('done')).toBe('1');
  });
});
