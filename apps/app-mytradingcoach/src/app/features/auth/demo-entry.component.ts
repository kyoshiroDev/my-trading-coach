import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth/auth.service';
import { environment } from '@app/environments/environment';

/**
 * Point d'entrée de la démo : connecte automatiquement le visiteur au compte
 * démo (lecture seule) puis redirige vers le dashboard. La landing pointe
 * simplement vers /demo : pas de token à transférer entre domaines.
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
