import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  LucideDynamicIcon,
  LucideEye as Eye,
  LucideEyeOff as EyeOff,
} from '@lucide/angular';
import { AuthService } from '../../core/auth/auth.service';
import { BillingApi } from '../../core/api/billing.api';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'mtc-register',
  imports: [FormsModule, RouterLink, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './register.component.css',
  templateUrl: './register.component.html',
})
export class RegisterComponent {
  private readonly auth = inject(AuthService);
  private readonly billingApi = inject(BillingApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  protected readonly EyeIcon = Eye;
  protected readonly EyeOffIcon = EyeOff;

  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly confirmPassword = signal('');
  protected readonly marketingConsent = signal(false);
  protected readonly isLoading = signal(false);
  protected readonly apiError = signal<string | null>(null);
  protected readonly showPassword = signal(false);
  protected readonly showConfirm = signal(false);
  protected readonly submitted = signal(false);
  protected readonly emailTouched = signal(false);
  protected readonly passwordTouched = signal(false);
  protected readonly confirmTouched = signal(false);
  protected readonly isPremiumFlow = signal(
    this.route.snapshot.queryParamMap.get('plan') === 'premium',
  );
  protected readonly referralCode = signal(this.resolveReferralCode());

  /**
   * Code de parrainage : query param `?ref` prioritaire (transmis par la landing),
   * sinon fallback localStorage. Persiste le code pour survivre à la navigation
   * interne de l'app (register → login → register) avant l'inscription.
   */
  private resolveReferralCode(): string {
    const KEY = 'mtc_ref';
    const fromUrl = (this.route.snapshot.queryParamMap.get('ref') ?? '')
      .trim()
      .toUpperCase();
    if (fromUrl) {
      try {
        localStorage.setItem(KEY, fromUrl);
      } catch {
        /* localStorage indisponible (SSR ou permission refusée) */
      }
      return fromUrl;
    }
    try {
      return (localStorage.getItem(KEY) ?? '').toUpperCase();
    } catch {
      return '';
    }
  }

  protected readonly emailError = computed(() => {
    if (!this.submitted() && !this.emailTouched()) return null;
    if (!this.email()) return "L'adresse email est requise";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email()))
      return 'Veuillez saisir une adresse email valide';
    return null;
  });

  protected readonly passwordError = computed(() => {
    if (!this.submitted() && !this.passwordTouched()) return null;
    if (!this.password()) return 'Le mot de passe est requis';
    if (this.password().length < 8)
      return 'Le mot de passe doit contenir au moins 8 caractères';
    if (!/[A-Z]/.test(this.password()))
      return 'Le mot de passe doit contenir au moins une majuscule';
    if (!/[0-9]/.test(this.password()))
      return 'Le mot de passe doit contenir au moins un chiffre';
    return null;
  });

  protected readonly confirmError = computed(() => {
    if (!this.submitted() && !this.confirmTouched()) return null;
    if (!this.confirmPassword()) return 'Veuillez confirmer votre mot de passe';
    if (this.password() !== this.confirmPassword())
      return 'Les mots de passe ne correspondent pas';
    return null;
  });

  onRegister() {
    this.submitted.set(true);
    if (this.emailError() || this.passwordError() || this.confirmError())
      return;

    this.isLoading.set(true);
    this.apiError.set(null);

    this.auth
      .register(
        this.email(),
        this.password(),
        this.name() || undefined,
        this.referralCode() || undefined,
        this.marketingConsent(),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          if (this.isPremiumFlow()) {
            this.billingApi
              .checkout('premium_monthly')
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe({
                next: (res) => {
                  window.location.href = res.data.url;
                },
                // Compte créé mais paiement indisponible : on continue, sans le cacher.
                error: () => {
                  this.isLoading.set(false);
                  this.toast.warning('Ton compte est créé. Le paiement n’a pas pu démarrer : tu peux lancer ton essai depuis ton Profil.');
                  this.router.navigate(['/dashboard']);
                },
              });
          } else {
            this.router.navigate(['/dashboard']);
          }
        },
        error: (err) => {
          const status = err.status;
          if (status === 409)
            this.apiError.set('Un compte existe déjà avec cette adresse email');
          else this.apiError.set('Une erreur est survenue, veuillez réessayer');
          this.isLoading.set(false);
        },
      });
  }
}
