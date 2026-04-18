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

        <form (ngSubmit)="onRegister()">
          <div class="form-group">
            <label for="name">Prénom <span class="optional">(optionnel)</span></label>
            <input
              id="name"
              type="text"
              [ngModel]="name()"
              (ngModelChange)="name.set($event)"
              name="name"
              placeholder="Alex"
              autocomplete="given-name"
            />
          </div>

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
            <label for="password">Mot de passe <span class="optional">(8 caractères min)</span></label>
            <div class="input-wrapper">
              <input
                id="password"
                [type]="showPassword() ? 'text' : 'password'"
                [ngModel]="password()"
                (ngModelChange)="password.set($event)"
                name="password"
                placeholder="••••••••"
                autocomplete="new-password"
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

          <div class="form-group" [class.input-error]="confirmError()">
            <label for="confirm-password">Confirmer le mot de passe</label>
            <div class="input-wrapper">
              <input
                id="confirm-password"
                [type]="showConfirm() ? 'text' : 'password'"
                [ngModel]="confirmPassword()"
                (ngModelChange)="confirmPassword.set($event)"
                name="confirmPassword"
                placeholder="••••••••"
                autocomplete="new-password"
                (blur)="confirmTouched.set(true)"
              />
              <button type="button" class="eye-btn" (click)="showConfirm.set(!showConfirm())">
                <lucide-icon [img]="showConfirm() ? EyeOffIcon : EyeIcon" [size]="15" color="var(--text-2)" />
              </button>
            </div>
            @if (confirmError()) {
              <span class="field-error">{{ confirmError() }}</span>
            }
          </div>

          <button type="submit" [disabled]="isLoading()" class="btn-submit">
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

          @if (apiError()) {
            <div class="error-msg">{{ apiError() }}</div>
          }
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

  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly confirmPassword = signal('');
  protected readonly isLoading = signal(false);
  protected readonly apiError = signal<string | null>(null);
  protected readonly showPassword = signal(false);
  protected readonly showConfirm = signal(false);
  protected readonly submitted = signal(false);
  protected readonly emailTouched = signal(false);
  protected readonly passwordTouched = signal(false);
  protected readonly confirmTouched = signal(false);
  protected readonly isPremiumFlow = signal(
    this.route.snapshot.queryParamMap.get('plan') === 'premium'
  );

  protected readonly emailError = computed(() => {
    if (!this.submitted() && !this.emailTouched()) return null;
    if (!this.email()) return "L'adresse email est requise";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email())) return 'Veuillez saisir une adresse email valide';
    return null;
  });

  protected readonly passwordError = computed(() => {
    if (!this.submitted() && !this.passwordTouched()) return null;
    if (!this.password()) return 'Le mot de passe est requis';
    if (this.password().length < 8) return 'Le mot de passe doit contenir au moins 8 caractères';
    if (!/[A-Z]/.test(this.password())) return 'Le mot de passe doit contenir au moins une majuscule';
    if (!/[0-9]/.test(this.password())) return 'Le mot de passe doit contenir au moins un chiffre';
    return null;
  });

  protected readonly confirmError = computed(() => {
    if (!this.submitted() && !this.confirmTouched()) return null;
    if (!this.confirmPassword()) return 'Veuillez confirmer votre mot de passe';
    if (this.password() !== this.confirmPassword()) return 'Les mots de passe ne correspondent pas';
    return null;
  });

  onRegister() {
    this.submitted.set(true);
    if (this.emailError() || this.passwordError() || this.confirmError()) return;

    this.isLoading.set(true);
    this.apiError.set(null);

    this.auth.register(this.email(), this.password(), this.name() || undefined)
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
          const status = err.status;
          if (status === 409) this.apiError.set('Un compte existe déjà avec cette adresse email');
          else this.apiError.set('Une erreur est survenue, veuillez réessayer');
          this.isLoading.set(false);
        },
      });
  }
}
