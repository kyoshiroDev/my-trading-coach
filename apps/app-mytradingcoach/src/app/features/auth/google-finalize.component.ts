import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { environment } from '@app/environments/environment';
import { AuthService } from '../../core/auth/auth.service';
import { PostSignupService } from '../../core/auth/post-signup.service';

const landing = environment.landingUrl.replace(/\/$/, '');

/**
 * Écran de finalisation d'une inscription Google (#618) : l'opt-in marketing est une case
 * explicite, non cochée, jamais implicite. Les CGU s'acceptent en créant le compte (CGU §1),
 * rappelées ici avec la politique de confidentialité. Ensuite, même parcours qu'une inscription
 * e-mail (offre du lien, paiement Premium ou tableau de bord).
 */
@Component({
  selector: 'mtc-google-finalize',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./auth-layout/card-page-signup.css', './google-finalize.component.css'],
  templateUrl: './google-finalize.component.html',
})
export class GoogleFinalizeComponent {
  private readonly auth = inject(AuthService);
  private readonly postSignup = inject(PostSignupService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly firstName = (this.auth.currentUser()?.name ?? '').split(' ')[0];
  protected readonly email = this.auth.currentUser()?.email ?? '';
  protected readonly marketingConsent = signal(false);
  protected readonly isLoading = signal(false);
  protected readonly apiError = signal<string | null>(null);
  protected readonly cguUrl = `${landing}/cgu`;
  protected readonly privacyUrl = `${landing}/politique-confidentialite`;
  private readonly premium = this.route.snapshot.queryParamMap.get('plan') === 'premium';

  constructor() {
    // Déjà finalisée (retour arrière, autre onglet) : pas de second choix, on continue.
    if (this.auth.currentUser()?.needsSignupFinalization === false) this.postSignup.afterLogin();
  }

  onContinue() {
    this.isLoading.set(true);
    this.apiError.set(null);
    this.auth
      .finalizeGoogleSignup(this.marketingConsent())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.postSignup.afterSignup({ premium: this.premium }),
        error: () => {
          this.apiError.set('Une erreur est survenue, réessaie dans un instant');
          this.isLoading.set(false);
        },
      });
  }
}
