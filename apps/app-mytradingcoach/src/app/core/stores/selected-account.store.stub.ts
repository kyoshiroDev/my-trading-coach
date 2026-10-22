import { signal } from '@angular/core';
import { countsInAggregate, type ExcludedAccounts } from '../utils/account-status.util';

/**
 * Tests uniquement : membres « comptes perdus » de `SelectedAccountStore` pour les faux stores
 * des specs (interrupteur, comptes exclus, paramètres des statistiques). À étaler EN PREMIER dans
 * le faux store : ses propres champs (`accounts`, `accountParam`…) priment.
 *
 *   { provide: SelectedAccountStore, useValue: { ...statsScopeStub(), accounts: signal([...]) } }
 */
type StubHost = {
  accounts: () => { status: string }[];
  accountParam?: () => string | undefined;
  includeInactive: () => boolean;
  selectedAccountId: () => string;
};

export function statsScopeStub() {
  return {
    accounts: signal<{ status: string }[]>([]),
    selectedAccountId: signal<string>('all'),
    includeInactive: signal(false),
    setIncludeInactive(this: { includeInactive: { set: (v: boolean) => void } }, on: boolean): void {
      this.includeInactive.set(on);
    },
    /** Compte choisi (null = « Tous les comptes »), comme `SelectedAccountStore.selected`. */
    selected(this: StubHost): { id: string; status: string } | null {
      const id = this.selectedAccountId();
      if (id === 'all') return null;
      const list = this.accounts() as { id?: string; status: string }[];
      return (list.find((a) => a.id === id) as { id: string; status: string } | undefined) ?? null;
    },
    inactiveIncluded(this: StubHost): boolean {
      return this.includeInactive() && this.selectedAccountId() === 'all';
    },
    aggregateAccounts(this: StubHost) {
      return this.accounts().filter((a) => countsInAggregate(a.status, this.includeInactive()));
    },
    excludedAccounts(this: StubHost): ExcludedAccounts {
      const list = this.accounts();
      return {
        failed: list.filter((a) => a.status === 'FAILED').length,
        archived: list.filter((a) => a.status === 'ARCHIVED').length,
      };
    },
    statsParams(this: StubHost & { inactiveIncluded: () => boolean }): Record<string, string> {
      const id = this.accountParam?.();
      if (id) return { accountId: id };
      return this.inactiveIncluded() ? { includeInactive: 'true' } : {};
    },
    statsQuery(this: { statsParams: () => Record<string, string> }): string {
      const q = new URLSearchParams(this.statsParams()).toString();
      return q ? `?${q}` : '';
    },
  };
}
