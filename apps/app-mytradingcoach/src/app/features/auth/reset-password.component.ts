import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  LucideDynamicIcon,
  LucideEye as Eye,
  LucideEyeOff as EyeOff,
} from '@lucide/angular';
import { AuthService } from '../../core/auth/auth.service';
import { apiErrorMessage } from '../../core/utils/api-error';

@Component({
  selector: 'mtc-reset-password',
  imports: [FormsModule, RouterLink, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './login.component.css',
  templateUrl: './reset-password.component.html',
})
export class ResetPasswordComponent {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly EyeIcon = Eye;
  protected readonly EyeOffIcon = EyeOff;

  protected password = '';
  protected confirm = '';
  protected readonly showPassword = signal(false);
  protected readonly isLoading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly success = signal(false);
  protected readonly token = signal<string | null>(
    this.route.snapshot.queryParamMap.get('token'),
  );

  onSubmit() {
    if (!this.password || this.password !== this.confirm) {
      this.error.set('Les mots de passe ne correspondent pas.');
      return;
    }
    if (this.password.length < 8) {
      this.error.set('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }

    const t = this.token();
    if (!t) return;

    this.isLoading.set(true);
    this.error.set(null);

    this.auth
      .resetPassword(t, this.password)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.success.set(true);
          this.isLoading.set(false);
        },
        error: (err) => {
          this.error.set(
            apiErrorMessage(err, 'Lien invalide ou expiré. Fais une nouvelle demande.'),
          );
          this.isLoading.set(false);
        },
      });
  }
}
