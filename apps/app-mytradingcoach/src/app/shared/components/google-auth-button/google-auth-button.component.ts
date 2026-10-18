import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { isInAppBrowser } from '@mtc/shared';
import {
  GOOGLE_BUTTON_MAX_WIDTH,
  GoogleIdentityService,
  type GoogleButtonText,
} from '../../../core/auth/google-identity.service';

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
  private readonly destroyRef = inject(DestroyRef);
  /** Largeur du dernier rendu : le bouton Google a une largeur fixe, redessiné si le formulaire change. */
  private renderedWidth = 0;

  constructor() {
    afterNextRender(() => void this.init());
  }

  private async init(): Promise<void> {
    const config = await this.google.config();
    if (!config.enabled) return this.state.set('hidden');
    if (isInAppBrowser(navigator.userAgent)) return this.state.set('in-app');
    const slot = this.host.nativeElement.querySelector<HTMLElement>('.slot');
    if (!slot) return this.state.set('hidden');
    const shown = await this.render(slot);
    this.state.set(shown ? 'ready' : 'hidden');
    if (shown) this.followWidth(slot);
  }

  /** Largeur réelle du formulaire (hôte en bloc pleine largeur), plafonnée à 400 px par Google. */
  private width(): number {
    return Math.min(GOOGLE_BUTTON_MAX_WIDTH, Math.floor(this.host.nativeElement.clientWidth));
  }

  private render(slot: HTMLElement): Promise<boolean> {
    this.renderedWidth = this.width();
    return this.google.renderButton(slot, this.text(), (c) => this.credential.emit(c), this.renderedWidth);
  }

  /** Rotation d'écran, fenêtre redimensionnée : bouton redessiné à la nouvelle largeur (150 ms). */
  private followWidth(slot: HTMLElement): void {
    if (typeof ResizeObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (this.width() !== this.renderedWidth) void this.render(slot);
      }, 150);
    });
    observer.observe(this.host.nativeElement);
    this.destroyRef.onDestroy(() => {
      clearTimeout(timer);
      observer.disconnect();
    });
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
