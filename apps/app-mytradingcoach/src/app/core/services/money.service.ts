import { Injectable, computed, inject } from '@angular/core';
import { MoneyOptions, formatMoney } from '@mtc/shared';
import { SelectedAccountStore } from '../stores/selected-account.store';

/**
 * Montants dans la devise NATIVE du compte : jamais de conversion, jamais de
 * préférence globale. Formateur et liste des devises : `@mtc/shared` (source unique front + back).
 *
 * - `format()` : totaux de l'écran courant, dans la devise du compte sélectionné (ou la devise
 *   commune de « Tous les comptes »).
 * - `formatFor(accountId)` : une ligne de trade, dans la devise de SON compte.
 * - `mixed()` : « Tous les comptes » avec des devises différentes. Les totaux n'ont alors pas de
 *   sens (on n'additionne pas des USD et des EUR) : les écrans affichent « choisis un compte ».
 */
@Injectable({ providedIn: 'root' })
export class MoneyService {
  private readonly accounts = inject(SelectedAccountStore);

  /** Devise des totaux affichés : code ISO, ou `null` si les comptes agrégés en ont plusieurs. */
  readonly currency = this.accounts.displayCurrency;

  readonly mixed = computed(
    () => this.accounts.selectedAccountId() === 'all' && this.currency() === null,
  );

  format(value: number, opts?: MoneyOptions): string {
    return formatMoney(value, this.currency(), opts);
  }

  /** Montant d'un trade dans la devise de son compte (repli : devise de l'écran). */
  formatFor(accountId: string | null | undefined, value: number, opts?: MoneyOptions): string {
    const currency = accountId ? this.accounts.currencyOf(accountId) : undefined;
    return formatMoney(value, currency ?? this.currency(), opts);
  }
}
