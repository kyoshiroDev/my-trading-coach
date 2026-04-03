import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule, Eye, EyeOff, Check } from 'lucide-angular';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'mtc-register',
  standalone: true,
  imports: [FormsModule, RouterLink, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './register.component.css',
  template: `
    <div class="auth-page">
      <div class="bg-glow"></div>

      <div class="auth-card">
        <!-- Logo -->
        <div class="auth-logo">
          <img src="icon/logo-navbar.svg" alt="MyTradingCoach">
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
                <lucide-icon [img]="showPassword() ? EyeOffIcon : EyeIcon" [size]="15" color="var(--text-2)" />
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
})
export class RegisterComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

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
