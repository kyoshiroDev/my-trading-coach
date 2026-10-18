import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { isInAppBrowser } from '@mtc/shared';
import { GoogleIdentityService, type GoogleButtonText } from '../../../core/auth/google-identity.service';

type State = 'loading' | 'ready' | 'hidden' | 'in-app';

/**
 * Bouton officiel « Continuer avec Google » (#618) + séparateur « ou » au-dessus du formulaire
 * e-mail. Rien n'est affiché si la connexion Google est inactive. Dans le navigateur intégré
 * d'Instagram, Facebook ou TikTok, Google refuse la connexion : on invite à ouvrir le navigateur
 * plutôt que de laisser un bouton qui échoue en silence.
 */
@Component({
  selector: 'mtc-google-auth-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './google-auth-button.component.css',
  templateUrl: './google-auth-button.component.html',
})
export class GoogleAuthButtonComponent {
  private readonly google = inject(GoogleIdentityService);

  /** Libellé Google : « Continuer avec » (inscription), « Se connecter avec » (connexion). */
  readonly text = input<GoogleButtonText>('continue_with');
  /** Bouton inactif pendant l'appel à l'API (le bouton Google lui-même reste cliquable). */
  readonly busy = input(false);
  readonly credential = output<string>();

  protected readonly state = signal<State>('loading');
  protected readonly linkCopied = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    afterNextRender(() => void this.init());
  }

  private async init(): Promise<void> {
    const config = await this.google.config();
    if (!config.enabled) return this.state.set('hidden');
    if (isInAppBrowser(navigator.userAgent)) return this.state.set('in-app');
    const slot = this.host.nativeElement.querySelector<HTMLElement>('.slot');
    if (!slot) return this.state.set('hidden');
    const shown = await this.google.renderButton(slot, this.text(), (c) => this.credential.emit(c));
    this.state.set(shown ? 'ready' : 'hidden');
  }

  protected async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(window.location.href);
      this.linkCopied.set(true);
    } catch {
      /* presse-papiers refusé : le texte suffit */
    }
  }
}
