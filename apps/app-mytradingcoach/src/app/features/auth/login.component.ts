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
import { Router, RouterLink } from '@angular/router';
import {
  LucideDynamicIcon,
  LucideEye as Eye,
  LucideEyeOff as EyeOff,
} from '@lucide/angular';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'mtc-login',
  imports: [FormsModule, RouterLink, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './login.component.css',
  templateUrl: './login.component.html',
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
        next: () => this.router.navigate(['/dashboard']),
        error: (err) => {
          const status = err.status;
          if (status === 401)
            this.apiError.set('Email ou mot de passe incorrect');
          else if (status === 404)
            this.apiError.set('Aucun compte trouvé avec cette adresse email');
          else this.apiError.set('Une erreur est survenue, réessaie dans un instant');
          this.isLoading.set(false);
        },
      });
  }
}
