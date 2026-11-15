import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { AccountsApi, TradingAccount } from '../api/accounts.api';
import { UserScopedReset } from '../auth/user-scoped-reset';
import { commonCurrency } from '@mtc/shared';
import { countsInAggregate, type ExcludedAccounts } from '../utils/account-status.util';

const STORAGE_KEY = 'mtc.selectedAccount';

/**
 * Compte sélectionné (multi-comptes) + liste des comptes (avec métriques règles de 089).
 * Accessible à tous (FREE : 1 compte · Premium : illimité, quota appliqué côté API).
 */
@Injectable({ providedIn: 'root' })
export class SelectedAccountStore {
  private readonly api = inject(AccountsApi);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    inject(UserScopedReset).register(() => this.reset());
  }

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
   * les comptes », la devise commune des comptes COMPTÉS (`aggregateCurrency` : sans les comptes
   * échoués ou archivés exclus des totaux, #947) ; `null` si elles diffèrent (on n'additionne pas des USD
   * et des EUR sous un symbole). Aucune conversion : jamais de `User.currencyRate`. Sans compte
   * chargé → USD, la devise par défaut d'un `TradingAccount`.
   */
  readonly displayCurrency = computed<string | null>(() => {
    const sel = this.selected();
    if (sel) return commonCurrency([sel.currency]);
    return this.aggregateCurrency();
  });

  /** Devise d'un compte donné (ligne de trade) ; `undefined` si le compte n'est pas chargé. */
  currencyOf(accountId: string): string | undefined {
    const a = this.accounts().find((x) => x.id === accountId);
    return a ? (commonCurrency([a.currency]) ?? undefined) : undefined;
  }

  /**
   * Interrupteur « Inclure les comptes échoués et archivés » (statistiques, journal, dashboard).
   * Désactivé par défaut et non persisté : chaque visite repart sur les seuls comptes en cours.
   */
  readonly includeInactive = signal(false);

  setIncludeInactive(on: boolean): void {
    this.includeInactive.set(on);
  }

  /** L'interrupteur ne change rien sur un compte précis : il ne joue que sur « Tous les comptes ». */
  readonly inactiveIncluded = computed(() => this.includeInactive() && this.selectedAccountId() === 'all');

  /** Comptes qui entrent dans les chiffres « tous les comptes » (capital, soldes agrégés). */
  readonly aggregateAccounts = computed(() =>
    this.accounts().filter((a) => countsInAggregate(a.status, this.includeInactive())),
  );

  /**
   * Devise commune des comptes comptés dans « Tous les comptes » (`null` si mêlées), indépendante
   * du compte choisi : le solde total du sélecteur l'utilise même quand un compte est sélectionné.
   */
  readonly aggregateCurrency = computed<string | null>(() => {
    const counted = this.aggregateAccounts();
    // Aucun compte compté (tous perdus) : la devise de tous, plutôt que l'USD par défaut.
    return commonCurrency((counted.length ? counted : this.accounts()).map((a) => a.currency));
  });

  /** Comptes hors statistiques par défaut, pour la ligne « n comptes exclus des chiffres ». */
  readonly excludedAccounts = computed<ExcludedAccounts>(() => ({
    failed: this.accounts().filter((a) => a.status === 'FAILED').length,
    archived: this.accounts().filter((a) => a.status === 'ARCHIVED').length,
  }));

  /**
   * Paramètres des appels de statistiques : `accountId` d'un compte précis, sinon `includeInactive`
   * quand l'interrupteur est actif. Vide = « Tous les comptes » sans les comptes perdus.
   */
  statsParams(): Record<string, string> {
    const id = this.accountParam();
    if (id) return { accountId: id };
    return this.inactiveIncluded() ? { includeInactive: 'true' } : {};
  }

  /** `statsParams()` en suffixe d'URL (`?accountId=…`, `?includeInactive=true` ou ''). */
  statsQuery(): string {
    const q = new URLSearchParams(this.statsParams()).toString();
    return q ? `?${q}` : '';
  }

  /** Comptes actifs (pour le choix de session : 1 session = 1 compte actif). */
  readonly activeAccounts = computed(() =>
    this.accounts().filter((a) => a.status === 'ACTIVE'),
  );

  /** Dernier chargement en échec : l'écran propose « Réessayer » au lieu d'une liste vide (#994). */
  readonly loadError = signal(false);

  /** Charge les comptes de l'utilisateur (FREE : 1 compte · Premium : illimité). */
  load(): void {
    this.isLoading.set(true);
    this.api
      .getAll()
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: (res) => {
          const list = res.data ?? [];
          this.loadError.set(false);
          this.accounts.set(list);
          this.loaded.set(true);
          // Compte sélectionné disparu → retour à l'agrégé. Un compte échoué ou archivé reste
          // sélectionnable : choisi dans le sélecteur, ses chiffres s'affichent normalement.
          const id = this.selectedAccountId();
          if (id !== 'all' && !list.some((a) => a.id === id)) this.select('all');
        },
        // AVANT : `accounts.set([])` — une erreur réseau (même au rechargement déclenché par le
        // socket Tradovate) vidait tableau, KPI et sélecteur en silence. Les comptes déjà connus
        // restent ; l'échec est signalé.
        error: () => {
          this.loadError.set(true);
          this.loaded.set(true);
        },
      });
  }

  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Recharge regroupée : le broker pousse le solde à chaque variation (plusieurs par trade). Une
   * rafale d'événements → UN rechargement de la liste, une seconde après le dernier.
   */
  reloadSoon(delayMs = 1_000): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      this.load();
    }, delayMs);
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
    this.loadError.set(false);
    this.accounts.set([]);
    this.loaded.set(false);
    this.isLoading.set(false);
    this.selectedAccountId.set('all');
    this.includeInactive.set(false);
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
