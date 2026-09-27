import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { AccountsApi, TradingAccount } from '../api/accounts.api';
import { commonCurrency } from '@mtc/shared';

const STORAGE_KEY = 'mtc.selectedAccount';

/**
 * Compte sélectionné (multi-comptes) + liste des comptes (avec métriques règles de 089).
 * Accessible à tous (FREE : 1 compte · Premium : illimité, quota appliqué côté API).
 */
@Injectable({ providedIn: 'root' })
export class SelectedAccountStore {
  private readonly api = inject(AccountsApi);
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

  /**
   * Devise NATIVE des montants affichés : celle du compte sélectionné ; en « Tous
   * les comptes », leur devise commune ; `null` si elles diffèrent (on n'additionne pas des USD
   * et des EUR sous un symbole). Aucune conversion : jamais de `User.currencyRate`. Sans compte
   * chargé → USD, la devise par défaut d'un `TradingAccount`.
   */
  readonly displayCurrency = computed<string | null>(() => {
    const sel = this.selected();
    if (sel) return commonCurrency([sel.currency]);
    return commonCurrency(this.accounts().map((a) => a.currency));
  });

  /** Devise d'un compte donné (ligne de trade) ; `undefined` si le compte n'est pas chargé. */
  currencyOf(accountId: string): string | undefined {
    const a = this.accounts().find((x) => x.id === accountId);
    return a ? (commonCurrency([a.currency]) ?? undefined) : undefined;
  }

  /** Comptes actifs (pour le choix de session : 1 session = 1 compte actif). */
  readonly activeAccounts = computed(() =>
    this.accounts().filter((a) => a.status === 'ACTIVE'),
  );

  /** Charge les comptes de l'utilisateur (FREE : 1 compte · Premium : illimité). */
  load(): void {
    this.isLoading.set(true);
    this.api
      .getAll()
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: (res) => {
          const list = res.data ?? [];
          this.accounts.set(list);
          this.loaded.set(true);
          // Si le compte sélectionné a disparu OU a été archivé → retour à l'agrégé.
          // (les comptes archivés sont masqués de la vue : ils ne doivent pas rester
          // le filtre actif des stats du dashboard / de la session.)
          const id = this.selectedAccountId();
          const stillSelectable = list.some(
            (a) => a.id === id && a.status !== 'ARCHIVED',
          );
          if (id !== 'all' && !stillSelectable) this.select('all');
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

  /**
   * Réinitialise le store (appelé au logout). Sans ça, se connecter à un AUTRE compte dans
   * le même onglet (navigation SPA, sans reload) laissait la liste des comptes + le compte
   * sélectionné du user précédent → import qui envoie un accountId d'un compte inaccessible
   * (« Compte introuvable »). On purge aussi la clé persistée.
   */
  reset(): void {
    this.accounts.set([]);
    this.loaded.set(false);
    this.isLoading.set(false);
    this.selectedAccountId.set('all');
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* stockage indispo */ }
  }

  /** Param à passer en query aux appels stats : undefined si « Tous », sinon l'id du compte. */
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
