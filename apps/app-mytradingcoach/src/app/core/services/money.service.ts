import { Injectable, inject } from '@angular/core';
import { SelectedAccountStore } from '../stores/selected-account.store';
import { MoneyOptions, formatMoney } from '../utils/money';

/**
 * Montants de l'écran courant dans la devise NATIVE du compte affiché (compte sélectionné, ou
 * devise commune de « Tous les comptes »), sans conversion. Source de `pnlFormat`, `money`,
 * du calendrier et des graphes (cf. core/utils/money.ts).
 */
@Injectable({ providedIn: 'root' })
export class MoneyService {
  private readonly accounts = inject(SelectedAccountStore);

  /** Devise affichée : code ISO, ou `null` si les comptes agrégés ont des devises différentes. */
  readonly currency = this.accounts.displayCurrency;

  format(value: number, opts?: MoneyOptions): string {
    return formatMoney(value, this.currency(), opts);
  }
}
