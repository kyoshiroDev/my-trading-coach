import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideDynamicIcon, LucideShare as Share } from '@lucide/angular';
import { InstallCapture } from '../../core/install/install-capture';
import { installState } from '../../core/install/install-prompt.service';
import { PUSH_BROWSER } from '../../core/push/push-browser';
import { devicePlace, inAppName } from '../../core/push/push-device';

/**
 * Page publique `/installer` (#1198, étape 3 de #715) : lien de l'e-mail et du QR code de la landing.
 * Détecte l'appareil et affiche directement les bonnes étapes, avec les textes de la feuille
 * d'installation. Sans connexion, sans mesure (les événements `install_*` restent liés au compte).
 * Après installation, l'app s'ouvre sur `/dashboard?source=pwa` (manifest), où se fait la connexion.
 */
@Component({
  selector: 'mtc-installer-page',
  imports: [RouterLink, LucideDynamicIcon],
  templateUrl: './installer-page.component.html',
  styleUrl: './installer-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstallerPageComponent {
  protected readonly ShareIcon = Share;
  private readonly browser = inject(PUSH_BROWSER);
  private readonly capture = inject(InstallCapture);

  protected readonly state = computed(() => installState(this.browser.env(), this.capture.prompt() !== null, this.capture.installed()));
  protected readonly isDesktop = devicePlace(this.browser.env()) === 'desktop';
  protected readonly appName = inAppName(this.browser.env().userAgent);
  protected readonly copied = signal<'ok' | 'error' | null>(null);
  protected readonly link = `${location.origin}/installer`;

  /** Invite du navigateur (Android, ordinateur) : ne sert qu'une fois, le navigateur en renverra une. */
  protected async install(): Promise<void> {
    const e = this.capture.prompt();
    if (!e) return;
    this.capture.prompt.set(null);
    try {
      await e.prompt();
      await e.userChoice;
    } catch {
      // Invite refusée par le navigateur : l'aide manuelle reste affichée.
    }
  }

  protected async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.link);
      this.copied.set('ok');
    } catch {
      this.copied.set('error');
    }
  }
}
