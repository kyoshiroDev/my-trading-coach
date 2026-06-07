import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth/auth.service';
import { environment } from '../../../environments/environment';

/**
 * Point d'entrée de la démo : connecte automatiquement le visiteur au compte
 * démo (lecture seule) puis redirige vers le dashboard. La landing pointe
 * simplement vers /demo — pas de token à transférer entre domaines.
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
  styles: [`
    .demo-entry { min-height: 100vh; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 10px; background: var(--bg, #080c14); color: var(--text, #e2eaf5); padding: 24px; text-align: center; }
    .demo-entry-title { font-size: 16px; font-weight: 600; margin: 0; }
    .demo-entry-sub { font-size: 13px; color: var(--text-2, #8fa3bf); margin: 0; }
    .demo-entry-link { margin-top: 12px; color: var(--blue-bright, #60a5fa); text-decoration: none; font-size: 13px; }
    .demo-spinner { width: 34px; height: 34px; border: 3px solid rgba(255,255,255,.15);
      border-top-color: var(--blue, #3b82f6); border-radius: 50%; animation: demo-spin .7s linear infinite; margin-bottom: 6px; }
    @keyframes demo-spin { to { transform: rotate(360deg); } }
  `],
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
