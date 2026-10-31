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
import { RouterLink } from '@angular/router';
import { EyeIconComponent } from '../../shared/components/eye-icon/eye-icon.component';
import { AuthService } from '../../core/auth/auth.service';
import { PostSignupService } from '../../core/auth/post-signup.service';
import { GoogleIdentityService } from '../../core/auth/google-identity.service';
import { GoogleSignInService, googleAuthErrorMessage } from '../../core/auth/google-sign-in.service';
import { GoogleAuthButtonComponent } from '../../shared/components/google-auth-button/google-auth-button.component';
import { AuthLayoutComponent } from './auth-layout/auth-layout.component';
import { SignupTermsNoteComponent } from './auth-layout/signup-terms-note.component';

@Component({
  selector: 'mtc-login',
  imports: [FormsModule, RouterLink, EyeIconComponent, GoogleAuthButtonComponent, AuthLayoutComponent, SignupTermsNoteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./auth-layout/auth-form.css', './login.component.css'],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly postSignup = inject(PostSignupService);
  private readonly googleSignIn = inject(GoogleSignInService);
  private readonly googleIdentity = inject(GoogleIdentityService);

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly isLoading = signal(false);
  protected readonly apiError = signal<string | null>(null);
  protected readonly showPassword = signal(false);
  protected readonly submitted = signal(false);
  protected readonly emailTouched = signal(false);
  protected readonly passwordTouched = signal(false);
  protected readonly googleLoading = signal(false);
  protected readonly googleError = signal<string | null>(null);
  /** Connexion Google active : le message d'échec du mot de passe la rappelle (comptes Google). */
  private readonly googleEnabled = signal(false);

  constructor() {
    void this.googleIdentity.config().then((c) => this.googleEnabled.set(c.enabled));
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
    return null;
  });

  onLogin() {
    this.submitted.set(true);
    if (this.emailError() || this.passwordError()) return;

    this.isLoading.set(true);
    this.apiError.set(null);

    this.auth
      .login(this.email(), this.password())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.postSignup.afterLogin(),
        error: (err) => {
          const status = err.status;
          if (status === 401)
            // Même 401 pour un compte Google sans mot de passe (anti-énumération) : on le rappelle.
            this.apiError.set(
              this.googleEnabled()
                ? 'Email ou mot de passe incorrect. Compte créé avec Google ? Utilise « Continuer avec Google ».'
                : 'Email ou mot de passe incorrect',
            );
          else if (status === 404)
            this.apiError.set('Aucun compte trouvé avec cette adresse email');
          else this.apiError.set('Une erreur est survenue, réessaie dans un instant');
          this.isLoading.set(false);
        },
      });
  }

  /** Retour du bouton Google (#618) : connexion, liaison ou création (parrain/UTM mémorisés). */
  onGoogleCredential(credential: string) {
    this.googleLoading.set(true);
    this.googleError.set(null);
    this.googleSignIn
      .signIn(credential)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: (err: unknown) => {
          this.googleError.set(googleAuthErrorMessage(err));
          this.googleLoading.set(false);
        },
      });
  }
}

/**
 * Colonne de présentation de mtc-auth-layout, servie par CE module : son `import()` réutilise le
 * morceau de la route /login au lieu d'en créer un nouveau, qui scindait le chunk partagé
 * d'Angular (+2,7 Ko au bundle initial).
 */
export { AuthPitchComponent } from './auth-layout/auth-pitch.component';
