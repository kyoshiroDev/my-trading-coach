import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'mtc-forgot-password',
  standalone: true,
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './login.component.css',
  template: `
    <div class="auth-page">
      <div class="bg-glow"></div>

      <div class="auth-card">
        <div class="auth-logo">
          <img src="icon/logo-navbar.svg" alt="MyTradingCoach">
        </div>

        <h1 class="auth-title">Mot de passe oublié ?</h1>
        <p class="auth-subtitle">Saisis ton email — on t'envoie un lien de réinitialisation</p>

        @if (success()) {
          <div class="success-msg">
            Si un compte existe pour cet email, un lien t'a été envoyé. Vérifie ta boîte mail (et les spams).
          </div>
        }

        @if (error()) {
          <div class="error-msg">{{ error() }}</div>
        }

        @if (!success()) {
          <form (ngSubmit)="onSubmit()" #form="ngForm">
            <div class="form-group">
              <label for="email">Email</label>
              <input
                id="email"
                type="email"
                [(ngModel)]="email"
                name="email"
                required
                placeholder="trader@email.com"
                autocomplete="email"
              />
            </div>
            <button type="submit" [disabled]="isLoading() || !email" class="btn-submit">
              @if (isLoading()) {
                <span class="spinner"></span> Envoi...
              } @else {
                Envoyer le lien
              }
            </button>
          </form>
        }

        <p class="auth-link">
          <a routerLink="/login">← Retour à la connexion</a>
        </p>
      </div>
    </div>
  `,
})
export class ForgotPasswordComponent {
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  protected email = '';
  protected readonly isLoading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly success = signal(false);

  onSubmit() {
    if (!this.email) return;
    this.isLoading.set(true);
    this.error.set(null);

    this.auth.forgotPassword(this.email).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
