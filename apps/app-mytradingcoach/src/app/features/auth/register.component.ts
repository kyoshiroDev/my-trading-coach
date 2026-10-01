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
import { AuthService, type Acquisition } from '../../core/auth/auth.service';
import { BillingService } from '../../core/services/billing.service';
import { ToastService } from '../../core/services/toast.service';

/** UTM d'acquisition en attente d'inscription (cf. resolveAcquisition). */
const UTM_STORAGE_KEY = 'mtc_utm';

@Component({
  selector: 'mtc-register',
  imports: [FormsModule, RouterLink, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './register.component.css',
  templateUrl: './register.component.html',
})
export class RegisterComponent {
  private readonly auth = inject(AuthService);
  private readonly billing = inject(BillingService);
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
  private readonly acquisition = this.resolveAcquisition();

  /**
   * UTM d'acquisition : query params `utm_*` (transmis par la landing) prioritaires,
   * sinon sessionStorage. Persistés le temps de la session pour survivre à la
   * navigation interne (register → login → register) ; nettoyés après inscription.
   * Indépendant du consentement cookies : donnée fonctionnelle de l'inscription.
   */
  private resolveAcquisition(): Acquisition {
    const params = this.route.snapshot.queryParamMap;
    const pick = (k: string) => params.get(k)?.trim().slice(0, 100) || undefined;
    const fromUrl: Acquisition = {
      acquisitionSource: pick('utm_source'),
      acquisitionMedium: pick('utm_medium'),
      acquisitionCampaign: pick('utm_campaign'),
    };
    if (Object.values(fromUrl).some(Boolean)) {
      try {
        sessionStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(fromUrl));
      } catch {
        /* sessionStorage indisponible */
      }
      return fromUrl;
    }
    try {
      return JSON.parse(sessionStorage.getItem(UTM_STORAGE_KEY) ?? '{}') as Acquisition;
    } catch {
      return {};
    }
  }

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
      return 'Saisis une adresse email valide';
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
    if (!this.confirmPassword()) return 'Confirme ton mot de passe';
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
        this.acquisition,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          try {
            sessionStorage.removeItem(UTM_STORAGE_KEY);
          } catch {
            /* sessionStorage indisponible */
          }
          if (this.isPremiumFlow()) {
            // Compte créé mais paiement indisponible : on continue, sans le cacher.
            this.billing.startCheckout('premium_monthly', () => {
              this.isLoading.set(false);
              this.toast.warning('Ton compte est créé. Le paiement n’a pas pu démarrer : tu peux lancer ton essai depuis ton Profil.');
              this.router.navigate(['/dashboard']);
            });
          } else {
            this.router.navigate(['/dashboard']);
          }
        },
        error: (err) => {
          const status = err.status;
          if (status === 409)
            this.apiError.set('Un compte existe déjà avec cette adresse email');
          else this.apiError.set('Une erreur est survenue, réessaie dans un instant');
          this.isLoading.set(false);
        },
      });
  }
}
