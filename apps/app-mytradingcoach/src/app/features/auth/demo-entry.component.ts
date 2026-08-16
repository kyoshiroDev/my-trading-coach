import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth/auth.service';
import { environment } from '../../../environments/environment';

/**
 * Point d'entrée de la démo : connecte automatiquement le visiteur au compte
 * démo (lecture seule) puis redirige vers le dashboard. La landing pointe
 * simplement vers /demo : pas de token à transférer entre domaines.
 */
@Component({
  selector: 'mtc-demo-entry',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="demo-entry">
      @if (error()) {
        <p class="demo-entry-title">Démo indisponible pour le moment</p>
        <p class="demo-entry-sub">Réessaie dans un instant.</p>
        <a class="demo-entry-link" [href]="landingUrl">← Retour à l'accueil</a>
      } @else {
        <div class="demo-spinner"></div>
        <p class="demo-entry-title">Préparation de la démo…</p>
        <p class="demo-entry-sub">Tu vas explorer MyTradingCoach avec des données d'exemple.</p>
      }
    </div>
  `,
  styleUrl: './demo-entry.component.css',
})
export class DemoEntryComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly error = signal(false);
  protected readonly landingUrl = environment.landingUrl;

  ngOnInit(): void {
    this.auth.demoLogin()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.router.navigate(['/dashboard']),
        error: () => this.error.set(true),
      });
  }
}
