import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LucideAngularModule, Eye, EyeOff } from 'lucide-angular';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'mtc-reset-password',
  standalone: true,
  imports: [FormsModule, RouterLink, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './login.component.css',
  template: `
    <div class="auth-page">
      <div class="bg-glow"></div>

      <div class="auth-card">
        <div class="auth-logo">
          <img src="icon/logo-navbar.svg" alt="MyTradingCoach">
        </div>

        <h1 class="auth-title">Nouveau mot de passe</h1>
        <p class="auth-subtitle">Choisis un mot de passe d'au moins 8 caractères</p>

        @if (!token()) {
          <div class="error-msg">Lien invalide ou expiré. Fais une nouvelle demande.</div>
          <p class="auth-link"><a routerLink="/forgot-password">Nouvelle demande →</a></p>
        }

        @if (token()) {
          @if (success()) {
            <div class="success-msg">
              Mot de passe modifié avec succès. Tu peux maintenant te connecter.
            </div>
            <p class="auth-link"><a routerLink="/login">Se connecter →</a></p>
          }

          @if (error()) {
            <div class="error-msg">{{ error() }}</div>
          }

          @if (!success()) {
            <form (ngSubmit)="onSubmit()" #form="ngForm">
              <div class="form-group">
                <label for="password">Nouveau mot de passe</label>
                <div class="input-wrapper">
                  <input
                    id="password"
                    [type]="showPassword() ? 'text' : 'password'"
                    [(ngModel)]="password"
                    name="password"
                    required
                    minlength="8"
                    placeholder="••••••••"
                    autocomplete="new-password"
                  />
                  <button type="button" class="eye-btn" (click)="showPassword.set(!showPassword())">
                    <lucide-icon [img]="showPassword() ? EyeOffIcon : EyeIcon" [size]="15" color="var(--text-2)" />
                  </button>
                </div>
              </div>
              <div class="form-group">
                <label for="confirm">Confirmer le mot de passe</label>
                <input
                  id="confirm"
                  [type]="showPassword() ? 'text' : 'password'"
                  [(ngModel)]="confirm"
                  name="confirm"
                  required
                  placeholder="••••••••"
                  autocomplete="new-password"
                />
              </div>
              <button type="submit" [disabled]="isLoading() || !password || password !== confirm" class="btn-submit">
                @if (isLoading()) {
                  <span class="spinner"></span> Enregistrement...
                } @else {
                  Enregistrer le mot de passe
                }
              </button>
            </form>
          }

          <p class="auth-link">
            <a routerLink="/login">← Retour à la connexion</a>
          </p>
        }
      </div>
    </div>
  `,
})
export class ResetPasswordComponent {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly EyeIcon = Eye;
  protected readonly EyeOffIcon = EyeOff;

  protected password = '';
  protected confirm = '';
  protected readonly showPassword = signal(false);
  protected readonly isLoading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly success = signal(false);
  protected readonly token = signal<string | null>(
    this.route.snapshot.queryParamMap.get('token'),
  );

  onSubmit() {
    if (!this.password || this.password !== this.confirm) {
      this.error.set('Les mots de passe ne correspondent pas.');
      return;
    }
    if (this.password.length < 8) {
      this.error.set('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }

    const t = this.token();
    if (!t) return;

    this.isLoading.set(true);
    this.error.set(null);

    this.auth.resetPassword(t, this.password).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.success.set(true);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.error.set(err.error?.message ?? 'Lien invalide ou expiré. Fais une nouvelle demande.');
        this.isLoading.set(false);
      },
    });
  }
}
