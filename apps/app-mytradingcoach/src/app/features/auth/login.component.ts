import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule, Eye, EyeOff } from 'lucide-angular';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'mtc-login',
  standalone: true,
  imports: [FormsModule, RouterLink, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth-page">
      <!-- Background glow -->
      <div class="bg-glow"></div>

      <div class="auth-card">
        <!-- Logo -->
        <div class="auth-logo">
          <img src="icon/logo-horizontal.svg" alt="MyTradingCoach" height="40" style="display:block;max-width:100%">
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
                <lucide-icon [img]="showPassword() ? EyeOffIcon : EyeIcon" [size]="15" color="var(--text-3)" />
              </button>
            </div>
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
  styles: [`
    .auth-page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--bg);
      position: relative;
      overflow: hidden;
      padding: 24px;
    }

    .bg-glow {
      position: absolute;
      top: -200px;
      left: 50%;
      transform: translateX(-50%);
      width: 600px;
      height: 600px;
      background: radial-gradient(ellipse at center, rgba(59,130,246,0.08) 0%, transparent 70%);
      pointer-events: none;
    }

    .auth-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 40px;
      width: 100%;
      max-width: 420px;
      position: relative;
      z-index: 1;
    }

    /* ─── Logo ─── */
    .auth-logo {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 28px;
    }

    /* ─── Headings ─── */
    .auth-title {
      font-family: var(--font-display);
      font-size: 22px;
      font-weight: 700;
      color: var(--text);
      text-align: center;
      margin-bottom: 6px;
      letter-spacing: -0.3px;
    }

    .auth-subtitle {
      font-size: 13px;
      color: var(--text-3);
      text-align: center;
      margin-bottom: 28px;
      line-height: 1.5;
    }

    /* ─── Error ─── */
    .error-msg {
      background: var(--red-dim);
      border: 1px solid var(--red);
      color: var(--red);
      padding: 10px 14px;
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 13px;
    }

    /* ─── Form ─── */
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 16px;
    }

    label {
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--text-2);
      letter-spacing: 0.3px;
    }

    input {
      background: var(--bg-2);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 14px;
      font-family: var(--font-body);
      outline: none;
      transition: border-color 0.15s;
      width: 100%;
      box-sizing: border-box;
    }

    input:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(59,130,246,0.12); }
    input::placeholder { color: var(--text-3); }

    .input-wrapper { position: relative; }
    .input-wrapper input { padding-right: 40px; }

    .eye-btn {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      cursor: pointer;
      padding: 2px;
      display: flex;
      align-items: center;
    }

    /* ─── Submit button ─── */
    .btn-submit {
      width: 100%;
      background: var(--blue);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 12px;
      font-size: 14px;
      font-weight: 600;
      font-family: var(--font-body);
      cursor: pointer;
      margin-top: 8px;
      transition: all 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 0 20px rgba(59,130,246,0.25);
    }

    .btn-submit:hover:not(:disabled) {
      background: #2563eb;
      box-shadow: 0 0 28px rgba(59,130,246,0.4);
    }

    .btn-submit:disabled { opacity: 0.6; cursor: not-allowed; }

    /* ─── Spinner ─── */
    .spinner {
      width: 14px; height: 14px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      flex-shrink: 0;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    /* ─── Footer link ─── */
    .auth-link {
      text-align: center;
      font-size: 13px;
      color: var(--text-3);
      margin-top: 20px;
    }

    .auth-link a {
      color: var(--blue-bright);
      text-decoration: none;
      font-weight: 500;
    }

    .auth-link a:hover { text-decoration: underline; }
  `],
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

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

    this.auth.login(this.email, this.password).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: (err) => {
        this.error.set(err.error?.message ?? 'Identifiants invalides');
        this.isLoading.set(false);
      },
    });
  }
}
