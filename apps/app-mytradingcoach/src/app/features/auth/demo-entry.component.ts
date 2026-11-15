import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth/auth.service';
import { environment } from '@app/environments/environment';
import { DemoService } from '../../core/services/demo.service';
import { SignupFunnelService } from '../../core/services/signup-funnel.service';

/**
 * Point d'entrée de la démo : connecte automatiquement le visiteur au compte
 * démo (lecture seule) puis redirige vers le dashboard. La landing pointe
 * simplement vers /demo : pas de token à transférer entre domaines. Les UTM et le parrain de
 * l'URL sont retenus pour le bouton « Créer mon compte » de la démo (#1029).
 */
@Component({
  selector: 'mtc-demo-entry',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './demo-entry.component.html',
  styleUrl: './demo-entry.component.css',
})
export class DemoEntryComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly demo = inject(DemoService);
  private readonly funnel = inject(SignupFunnelService);

  protected readonly error = signal(false);
  protected readonly landingUrl = environment.landingUrl;

  ngOnInit(): void {
    // Origine de la visite (UTM de la landing ou du lien, parrain) pour le lien d'inscription.
    this.demo.captureOrigin(window.location.search);
    // Mode interne (`?internal=1`, capté au démarrage par App) : ouverture non comptée.
    this.auth.demoLogin(this.funnel.internal())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.router.navigate(['/dashboard']),
        error: () => this.error.set(true),
      });
  }
}
