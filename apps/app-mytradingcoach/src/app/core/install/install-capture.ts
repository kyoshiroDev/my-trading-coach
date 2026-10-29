import { DestroyRef, Injectable, Injector, inject, signal } from '@angular/core';

/** Événement `beforeinstallprompt` (Chrome, Edge), absent des types du DOM. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Feuille affichée : parcours d'installation, ou invitation aux alertes une fois installée. */
export type InstallSheet = 'install' | 'push';

/**
 * SEULE partie de l'installation dans le bundle initial (budget : marge de 6 ko sous 500 ko).
 * Chrome envoie `beforeinstallprompt` (et `appinstalled`) à tout moment, souvent avant que le
 * parcours soit chargé : on les garde ici, puis `InstallPromptService`, chargé à la demande, les
 * lit. Contient aussi l'état d'ouverture de la feuille, que `App` lit pour la charger (`@defer`).
 */
@Injectable({ providedIn: 'root' })
export class InstallCapture {
  private readonly injector = inject(Injector);
  /** Invite du navigateur gardée pour notre bouton « Installer ». */
  readonly prompt = signal<BeforeInstallPromptEvent | null>(null);
  /** Installation confirmée par le navigateur dans cet onglet. */
  readonly installed = signal(false);
  readonly sheet = signal<InstallSheet | null>(null);

  constructor() {
    if (typeof window === 'undefined') return;
    const onPrompt = (e: Event) => {
      // Sinon Chrome affiche sa propre barre d'installation, à l'arrivée.
      e.preventDefault();
      this.prompt.set(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      this.prompt.set(null);
      this.installed.set(true);
      // Compte l'installation (une fois par appareil) : le service la lit à sa création.
      void this.load();
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    });
  }

  /** Charge le parcours (fichier à la demande) et renvoie son service. */
  async load() {
    const { InstallPromptService } = await import('./install-prompt.service');
    return this.injector.get(InstallPromptService);
  }
}
