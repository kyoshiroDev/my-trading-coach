import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { GoogleIdentityService } from '../../core/auth/google-identity.service';

@Component({
  selector: 'mtc-forgot-password',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-layout/card-page.css',
  templateUrl: './forgot-password.component.html',
})
export class ForgotPasswordComponent {
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  protected email = '';
  protected readonly isLoading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly success = signal(false);
  /** Connexion Google active : rappel pour les comptes créés avec Google (#618). */
  protected readonly googleEnabled = signal(false);

  constructor() {
    void inject(GoogleIdentityService)
      .config()
      .then((c) => this.googleEnabled.set(c.enabled));
  }

  onSubmit() {
    if (!this.email) return;
    this.isLoading.set(true);
    this.error.set(null);

    this.auth
      .forgotPassword(this.email)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.success.set(true);
          this.isLoading.set(false);
        },
        // L'API répond 204 pour toute adresse (anti-énumération) : une erreur n'est donc jamais
        // « adresse inconnue », c'est une panne ou un refus de débit. Avant, l'écran annonçait
        // l'envoi quand même et l'utilisateur attendait un e-mail qui ne partirait jamais (#994).
        error: (err: { status?: number }) => {
          this.error.set(
            err?.status === 429
              ? 'Trop de demandes. Réessaie dans quelques minutes.'
              : err?.status === 400
                ? 'Saisis une adresse e-mail valide.'
                : 'Le service ne répond pas. Réessaie dans un instant.',
          );
          this.isLoading.set(false);
        },
      });
  }
}
