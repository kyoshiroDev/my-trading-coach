import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LucideAngularModule, Lock, X } from 'lucide-angular';
import { TradovateStore, tradovateErrorText } from '../../../core/stores/tradovate.store';
import type { TradovateOrigin } from '../../../core/api/tradovate.api';

/**
 * Écran de réassurance AVANT de quitter l'app pour Tradovate (PROMPT-208, écran 2).
 * Réutilisé par le wizard (étape 8) et « Mes comptes ». Insiste sur la lecture seule :
 * jamais le mot de passe, aucun ordre, révocable.
 *
 * Aucune donnée n'est créée ici : la connexion n'existe qu'au retour de Tradovate. Fermer
 * l'onglet Tradovate en cours de route ne laisse donc aucun demi-état.
 */
@Component({
  selector: 'mtc-tradovate-connect-modal',
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tradovate-connect-modal.component.html',
  styleUrl: './tradovate-connect-modal.component.css',
})
export class TradovateConnectModalComponent {
  readonly accountId = input.required<string>();
  readonly accountLabel = input<string>('');
  readonly origin = input<TradovateOrigin>('settings');
  readonly closed = output<void>();

  private readonly store = inject(TradovateStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly LockIcon = Lock;
  protected readonly XIcon = X;
  protected readonly redirecting = signal(false);
  protected readonly error = signal<string | null>(null);

  protected connect(): void {
    if (this.redirecting()) return;
    this.redirecting.set(true);
    this.error.set(null);
    this.store
      .authorizeUrl(this.accountId(), this.origin())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        // On reste en « Redirection… » : la page va être quittée.
        next: (url) => this.navigateTo(url),
        error: (err) => {
          this.redirecting.set(false);
          this.error.set(
            tradovateErrorText(err, "La connexion Tradovate n'a pas pu démarrer. Réessaie dans un instant."),
          );
        },
      });
  }

  protected cancel(): void {
    if (this.redirecting()) return;
    this.closed.emit();
  }

  /** Point unique de sortie de l'app (espionné en test). */
  protected navigateTo(url: string): void {
    window.location.assign(url);
  }
}
