import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
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
      <div class="bg-glow"></div>

      <div class="auth-card">
        <div class="auth-logo">
          <img src="icon/logo-navbar.svg" alt="MyTradingCoach">
        </div>

        <h1 class="auth-title">Bon retour 👋</h1>
        <p class="auth-subtitle">Connecte-toi pour accéder à ton journal de trading</p>

        <form (ngSubmit)="onLogin()">
          <div class="form-group" [class.input-error]="emailError()">
            <label for="email">Email</label>
            <input
              id="email"
              type="email"
              [ngModel]="email()"
              (ngModelChange)="email.set($event)"
              name="email"
              placeholder="trader@email.com"
              autocomplete="email"
              (blur)="emailTouched.set(true)"
            />
            @if (emailError()) {
              <span class="field-error">{{ emailError() }}</span>
            }
          </div>

          <div class="form-group" [class.input-error]="passwordError()">
            <label for="password">Mot de passe</label>
            <div class="input-wrapper">
              <input
                id="password"
                [type]="showPassword() ? 'text' : 'password'"
                [ngModel]="password()"
                (ngModelChange)="password.set($event)"
                name="password"
                placeholder="••••••••"
                autocomplete="current-password"
                (blur)="passwordTouched.set(true)"
              />
              <button type="button" class="eye-btn" (click)="showPassword.set(!showPassword())">
                <lucide-icon [img]="showPassword() ? EyeOffIcon : EyeIcon" [size]="15" color="var(--text-2)" />
              </button>
            </div>
            @if (passwordError()) {
              <span class="field-error">{{ passwordError() }}</span>
            }
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

          @if (apiError()) {
            <div class="error-msg">{{ apiError() }}</div>
          }
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

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly isLoading = signal(false);
  protected readonly apiError = signal<string | null>(null);
  protected readonly showPassword = signal(false);
  protected readonly submitted = signal(false);
  protected readonly emailTouched = signal(false);
  protected readonly passwordTouched = signal(false);

  protected readonly emailError = computed(() => {
    if (!this.submitted() && !this.emailTouched()) return null;
    if (!this.email()) return "L'adresse email est requise";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email())) return 'Veuillez saisir une adresse email valide';
    return null;
  });

  protected readonly passwordError = computed(() => {
    if (!this.submitted() && !this.passwordTouched()) return null;
    if (!this.password()) return 'Le mot de passe est requis';
    return null;
  });

  onLogin() {
    this.submitted.set(true);
    if (this.emailError() || this.passwordError()) return;

    this.isLoading.set(true);
    this.apiError.set(null);

    this.auth.login(this.email(), this.password()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: (err) => {
        const status = err.status;
        if (status === 401) this.apiError.set('Email ou mot de passe incorrect');
        else if (status === 404) this.apiError.set('Aucun compte trouvé avec cette adresse email');
        else this.apiError.set('Une erreur est survenue, veuillez réessayer');
        this.isLoading.set(false);
      },
    });
  }
}
