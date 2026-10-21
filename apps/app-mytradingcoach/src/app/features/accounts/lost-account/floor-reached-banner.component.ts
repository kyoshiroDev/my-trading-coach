import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SelectedAccountStore } from '@app/core/stores/selected-account.store';
import type { TradingAccount } from '@app/core/api/accounts.api';
import { LostAccountFlowService } from '@app/core/services/lost-account-flow.service';
import { floorBannerAccounts, readSnoozes, snoozeFloor, type FloorSnoozes } from './floor-snooze.util';

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * Bandeau « Plancher atteint » (écran 1 de la maquette), en haut du tableau de bord et de Mes
 * comptes : un par compte ACTIF dont la marge estimée est épuisée (`floorReached` de l'API).
 * « Marquer comme échoué » ouvre la feuille de choix ; « Pas maintenant » masque CE compte 24 h.
 * Aucun statut n'est changé ici.
 */
@Component({
  selector: 'mtc-floor-reached-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Sans bandeau, l'hôte disparaît : il ne laisse pas d'écart vide dans la colonne du parent.
  host: { '[class.is-empty]': 'accounts().length === 0' },
  templateUrl: './floor-reached-banner.component.html',
  styleUrl: './floor-reached-banner.component.css',
})
export class FloorReachedBannerComponent {
  private readonly store = inject(SelectedAccountStore);
  protected readonly flow = inject(LostAccountFlowService);

  private readonly snoozes = signal<FloorSnoozes>(readSnoozes(storage(), Date.now()));

  protected readonly accounts = computed(() =>
    floorBannerAccounts(this.store.accounts(), this.snoozes(), Date.now()),
  );

  protected snooze(a: TradingAccount): void {
    this.snoozes.set(snoozeFloor(storage(), a.id, Date.now()));
  }

  /** Évaluation : « si l'évaluation est terminée » ; compte funded : « si le compte est perdu ». */
  protected endedLabel(a: TradingAccount): string {
    return a.type === 'EVALUATION' ? "Si l'évaluation est terminée" : 'Si le compte est perdu chez ta firm';
  }
}
