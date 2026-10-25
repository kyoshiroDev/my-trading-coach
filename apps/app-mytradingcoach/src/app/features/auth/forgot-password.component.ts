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
        error: () => {
          // Anti-énumération : même message en cas d'erreur
          this.success.set(true);
          this.isLoading.set(false);
        },
      });
  }
}
