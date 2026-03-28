import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule, TrendingUp, Eye, EyeOff, Check } from 'lucide-angular';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'mtc-register',
  standalone: true,
  imports: [FormsModule, RouterLink, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth-page">
      <div class="bg-glow"></div>

      <div class="auth-card">
        <!-- Logo -->
        <div class="auth-logo">
          <div class="logo-icon">
            <lucide-icon [img]="TrendingUpIcon" [size]="18" color="#3b82f6" />
          </div>
          <span class="logo-text">MyTrading<strong>Coach</strong></span>
        </div>

        <h1 class="auth-title">Commence gratuitement</h1>
        <p class="auth-subtitle">Rejoins les traders qui progressent avec l'IA</p>

        <!-- Free plan benefits -->
        <div class="benefits">
          @for (benefit of benefits; track benefit) {
            <div class="benefit-row">
              <lucide-icon [img]="CheckIcon" [size]="13" color="var(--green)" />
              <span>{{ benefit }}</span>
            </div>
          }
        </div>

        @if (error()) {
          <div class="error-msg">{{ error() }}</div>
        }

        <form (ngSubmit)="onRegister()">
          <div class="form-group">
            <label for="name">Prénom <span class="optional">(optionnel)</span></label>
            <input
              id="name"
              type="text"
              [(ngModel)]="name"
              name="name"
              placeholder="Alex"
              autocomplete="given-name"
            />
          </div>
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
            <label for="password">Mot de passe <span class="optional">(8 caractères min)</span></label>
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
                <lucide-icon [img]="showPassword() ? EyeOffIcon : EyeIcon" [size]="15" color="var(--text-3)" />
              </button>
            </div>
          </div>
          <button type="submit" [disabled]="isLoading()" class="btn-submit">
            @if (isLoading()) {
              <span class="spinner"></span> Création...
            } @else {
              Créer mon compte gratuit
            }
          </button>
        </form>

        <p class="free-note">Aucune CB requise · 50 trades/mois · Annuler à tout moment</p>

        <p class="auth-link">
          Déjà un compte ? <a routerLink="/login">Se connecter</a>
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
      max-width: 440px;
      position: relative;
      z-index: 1;
    }

    /* ─── Logo ─── */
    .auth-logo {
      display: flex;
      align-items: center;
      gap: 10px;
      justify-content: center;
      margin-bottom: 24px;
    }

    .logo-icon {
      width: 34px;
      height: 34px;
      background: linear-gradient(135deg, #1d4ed8, #2563eb);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 16px rgba(59,130,246,0.35);
      flex-shrink: 0;
    }

    .logo-text {
      font-family: var(--font-display);
      font-size: 17px;
      font-weight: 500;
      color: var(--text);
      letter-spacing: -0.3px;
    }

    .logo-text strong { font-weight: 800; }

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
      margin-bottom: 20px;
    }

    /* ─── Benefits ─── */
    .benefits {
      background: var(--bg-2);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 24px;
      display: flex;
      flex-direction: column;
      gap: 7px;
    }

    .benefit-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--text-2);
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
      margin-bottom: 14px;
    }

    label {
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--text-2);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .optional {
      font-size: 11px;
      color: var(--text-3);
      font-weight: 400;
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

    /* ─── Submit ─── */
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

    /* ─── Footer ─── */
    .free-note {
      text-align: center;
      font-size: 11px;
      color: var(--text-3);
      font-family: var(--font-mono);
      margin-top: 12px;
    }

    .auth-link {
      text-align: center;
      font-size: 13px;
      color: var(--text-3);
      margin-top: 16px;
    }

    .auth-link a {
      color: var(--blue-bright);
      text-decoration: none;
      font-weight: 500;
    }

    .auth-link a:hover { text-decoration: underline; }
  `],
})
export class RegisterComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly TrendingUpIcon = TrendingUp;
  protected readonly EyeIcon = Eye;
  protected readonly EyeOffIcon = EyeOff;
  protected readonly CheckIcon = Check;

  protected readonly benefits = [
    '50 trades/mois inclus',
    'Statistiques de base',
    'Journal illimité en lecture',
  ];

  protected name = '';
  protected email = '';
  protected password = '';
  protected readonly isLoading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showPassword = signal(false);

  onRegister() {
    if (!this.email || !this.password) return;
    this.isLoading.set(true);
    this.error.set(null);

    this.auth.register(this.email, this.password, this.name || undefined).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: (err) => {
        this.error.set(err.error?.message ?? "Erreur lors de l'inscription");
        this.isLoading.set(false);
      },
    });
  }
}
