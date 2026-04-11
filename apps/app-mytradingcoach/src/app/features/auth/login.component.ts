import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule, Eye, EyeOff } from 'lucide-angular';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'mtc-login',
  standalone: true,
  imports: [FormsModule, RouterLink, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './login.component.css',
  template: `
    <div class="auth-page">
      <!-- Background glow -->
      <div class="bg-glow"></div>

      <div class="auth-card">
        <!-- Logo -->
        <div class="auth-logo">
          <img src="icon/logo-navbar.svg" alt="MyTradingCoach">
        </div>

        <h1 class="auth-title">Bon retour 👋</h1>
        <p class="auth-subtitle">Connecte-toi pour accéder à ton journal de trading</p>

        @if (error()) {
          <div class="error-msg">{{ error() }}</div>
        }

        <form (ngSubmit)="onLogin()" #form="ngForm">
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
          <div class="form-group">
            <label for="password">Mot de passe</label>
            <div class="input-wrapper">
              <input
                id="password"
                [type]="showPassword() ? 'text' : 'password'"
                [(ngModel)]="password"
                name="password"
                required
                placeholder="••••••••"
                autocomplete="current-password"
              />
              <button type="button" class="eye-btn" (click)="showPassword.set(!showPassword())">
                <lucide-icon [img]="showPassword() ? EyeOffIcon : EyeIcon" [size]="15" color="var(--text-2)" />
              </button>
            </div>
          </div>
          <div class="forgot-link-row">
            <a routerLink="/forgot-password" class="forgot-link">Mot de passe oublié ?</a>
          </div>
          <button type="submit" [disabled]="isLoading()" class="btn-submit">
            @if (isLoading()) {
              <span class="spinner"></span> Connexion...
            } @else {
              Se connecter
            }
          </button>
        </form>

        <p class="auth-link">
          Pas encore de compte ? <a routerLink="/register">S'inscrire gratuitement</a>
        </p>
      </div>
    </div>
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly EyeIcon = Eye;
  protected readonly EyeOffIcon = EyeOff;

  protected email = '';
  protected password = '';
  protected readonly isLoading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showPassword = signal(false);

  onLogin() {
    if (!this.email || !this.password) return;
    this.isLoading.set(true);
    this.error.set(null);

    this.auth.login(this.email, this.password).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: (err) => {
        this.error.set(err.error?.message ?? 'Identifiants invalides');
        this.isLoading.set(false);
      },
    });
  }
}
