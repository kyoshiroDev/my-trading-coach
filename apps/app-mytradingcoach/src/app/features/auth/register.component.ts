import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule, Eye, EyeOff } from 'lucide-angular';
import { AuthService } from '../../core/auth/auth.service';
import { BillingApi } from '../../core/api/billing.api';

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

        <h1 class="auth-title">
          @if (isPremiumFlow()) { Créer ton compte Premium } @else { Commence gratuitement }
        </h1>
        <p class="auth-subtitle">
          @if (isPremiumFlow()) {
            Tu seras redirigé vers le paiement après l'inscription
          } @else {
            Rejoins les traders qui progressent avec l'IA
          }
        </p>

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
          <div class="form-group">
            <label for="confirm-password">Confirmer le mot de passe</label>
            <div class="input-wrapper" [class.input-error]="confirmMismatch()">
              <input
                id="confirm-password"
                [type]="showConfirm() ? 'text' : 'password'"
                [(ngModel)]="confirmPassword"
                name="confirmPassword"
                required
                placeholder="••••••••"
                autocomplete="new-password"
              />
              <button type="button" class="eye-btn" (click)="showConfirm.set(!showConfirm())">
                <lucide-icon [img]="showConfirm() ? EyeOffIcon : EyeIcon" [size]="15" color="var(--text-2)" />
              </button>
            </div>
            @if (confirmMismatch()) {
              <span class="field-error">Les mots de passe ne correspondent pas</span>
            }
          </div>
          <button type="submit" [disabled]="isLoading() || confirmMismatch()" class="btn-submit">
            @if (isLoading()) {
              <span class="spinner"></span>
              @if (isPremiumFlow()) { Création et redirection... } @else { Création... }
            } @else {
              @if (isPremiumFlow()) {
                Créer mon compte et continuer vers le paiement →
              } @else {
                Créer mon compte gratuit
              }
            }
          </button>
        </form>

        <p class="free-note">
          @if (isPremiumFlow()) {
            Essai 7 jours gratuit · Sans CB requise · Annuler à tout moment
          } @else {
            Aucune CB requise · 50 trades/mois · Annuler à tout moment
          }
        </p>

        <p class="auth-link">
          Déjà un compte ? <a routerLink="/login">Se connecter</a>
        </p>
      </div>
    </div>
  `,
})
export class RegisterComponent {
  private readonly auth = inject(AuthService);
  private readonly billingApi = inject(BillingApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly EyeIcon = Eye;
  protected readonly EyeOffIcon = EyeOff;

  protected name = '';
  protected email = '';
  protected password = '';
  protected confirmPassword = '';
  protected readonly isLoading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showPassword = signal(false);
  protected readonly showConfirm = signal(false);
  protected readonly confirmMismatch = computed(
    () => !!this.confirmPassword && this.password !== this.confirmPassword
  );
  protected readonly isPremiumFlow = signal(
    this.route.snapshot.queryParamMap.get('plan') === 'premium'
  );

  onRegister() {
    if (!this.email || !this.password) return;
    if (this.password !== this.confirmPassword) return;
    this.isLoading.set(true);
    this.error.set(null);

    this.auth.register(this.email, this.password, this.name || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          if (this.isPremiumFlow()) {
            this.billingApi.checkout('monthly')
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe({
                next: (res) => { window.location.href = res.data.url; },
                error: () => {
                  this.isLoading.set(false);
                  this.router.navigate(['/dashboard']);
                },
              });
          } else {
            this.router.navigate(['/dashboard']);
          }
        },
        error: (err) => {
          this.error.set(err.error?.message ?? "Erreur lors de l'inscription");
          this.isLoading.set(false);
        },
      });
  }
}
