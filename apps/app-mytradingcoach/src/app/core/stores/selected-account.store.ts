import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { AccountsApi, TradingAccount } from '../api/accounts.api';
import { UserStore } from './user.store';

const STORAGE_KEY = 'mtc.selectedAccount';

/**
 * Compte sélectionné (multi-comptes) + liste des comptes (avec métriques règles de 089).
 * Réservé PREMIUM : aucun appel `/accounts` pour un non-Premium.
 */
@Injectable({ providedIn: 'root' })
export class SelectedAccountStore {
  private readonly api = inject(AccountsApi);
  private readonly userStore = inject(UserStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly accounts = signal<TradingAccount[]>([]);
  readonly isLoading = signal(false);
  readonly loaded = signal(false);

  /** 'all' (agrégé) ou l'id d'un compte. Initialisé depuis le stockage. */
  readonly selectedAccountId = signal<string | 'all'>(this.readPersisted());

  /** Le compte sélectionné, ou null si « Tous les comptes ». */
  readonly selected = computed<TradingAccount | null>(() => {
    const id = this.selectedAccountId();
    if (id === 'all') return null;
    return this.accounts().find((a) => a.id === id) ?? null;
  });

  /** Comptes actifs (pour le choix de session : 1 session = 1 compte actif). */
  readonly activeAccounts = computed(() =>
    this.accounts().filter((a) => a.status === 'ACTIVE'),
  );

  /** Charge les comptes (Premium uniquement). Non-Premium → liste vide, aucun appel réseau. */
  load(): void {
    if (!this.userStore.isPremium()) {
      this.accounts.set([]);
      this.loaded.set(true);
      return;
    }
    this.isLoading.set(true);
    this.api
      .getAll()
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: (res) => {
          const list = res.data ?? [];
          this.accounts.set(list);
          this.loaded.set(true);
          // Si le compte sélectionné n'existe plus (archivé/supprimé) → retour à l'agrégé.
          const id = this.selectedAccountId();
          if (id !== 'all' && !list.some((a) => a.id === id)) this.select('all');
        },
        error: () => {
          this.accounts.set([]);
          this.loaded.set(true);
        },
      });
  }

  select(id: string | 'all'): void {
    this.selectedAccountId.set(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* stockage indispo */ }
  }

  /** Param à passer en query aux appels stats : undefined si « Tous ». */
  accountParam(): string | undefined {
    const id = this.selectedAccountId();
    return id === 'all' ? undefined : id;
  }

  private readPersisted(): string | 'all' {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'all';
    } catch {
      return 'all';
    }
  }
}
