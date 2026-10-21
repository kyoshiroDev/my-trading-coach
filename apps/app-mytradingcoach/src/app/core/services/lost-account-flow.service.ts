import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ConfirmService } from '@mtc/front-ui';
import { nextAttemptLabel } from '@mtc/shared';
import { AccountsApi, TradingAccount } from '@app/core/api/accounts.api';
import { SelectedAccountStore } from '@app/core/stores/selected-account.store';
import { TradesStore } from '@app/core/stores/trades.store';
import { ToastService } from '@app/core/services/toast.service';
import { apiErrorMessage } from '@app/core/utils/api-error';

/** Sort d'un compte dont le plancher est atteint (feuille « Apex 50K #1 est échoué »). */
export type LostAccountChoice = 'archive' | 'keep' | 'delete';

/**
 * Compte perdu : feuilles « que faire de ce compte ? » et « nouvelle tentative », ouvertes depuis
 * le bandeau « Plancher atteint », l'alerte live ou Mes comptes, et rendues une seule fois par
 * `mtc-lost-account-sheets` (coque connectée). Les états gardent l'id du compte, jamais l'objet
 * (cf. angular.md). Aucun statut n'est changé sans un clic de l'utilisateur sur « Confirmer ».
 */
@Injectable({ providedIn: 'root' })
export class LostAccountFlowService {
  private readonly api = inject(AccountsApi);
  private readonly store = inject(SelectedAccountStore);
  private readonly tradesStore = inject(TradesStore);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  /** Feuille de choix ouverte pour ce compte. */
  readonly choiceId = signal<string | null>(null);
  /** Feuille « Repartir sur une nouvelle tentative » ouverte pour ce compte échoué. */
  readonly retryId = signal<string | null>(null);
  /** Requête en cours (boutons désactivés, pas de double envoi). */
  readonly busy = signal(false);

  readonly choiceAccount = computed(() => this.find(this.choiceId()));
  readonly retryAccount = computed(() => this.find(this.retryId()));
  /** Libellé que le serveur donnera à la nouvelle tentative (« Apex 50K #2 »), pour l'annoncer. */
  readonly retryLabel = computed(() => {
    const a = this.retryAccount();
    return a ? nextAttemptLabel(a.label, this.store.accounts().map((x) => x.label)) : null;
  });

  /** « Marquer comme échoué » : ouvre la feuille de choix, rien n'est encore enregistré. */
  openChoice(accountId: string): void {
    // Depuis l'alerte live, la liste des comptes n'est pas forcément chargée : la feuille
    // s'ouvre dès que le compte y apparaît.
    if (!this.store.loaded() && !this.store.isLoading()) this.store.load();
    this.retryId.set(null);
    this.choiceId.set(accountId);
  }

  closeChoice(): void {
    if (!this.busy()) this.choiceId.set(null);
  }

  openRetry(accountId: string): void {
    this.choiceId.set(null);
    this.retryId.set(accountId);
  }

  closeRetry(): void {
    if (!this.busy()) this.retryId.set(null);
  }

  /**
   * « Confirmer » de la feuille de choix. Archiver ou garder comme échoué : un PATCH du statut.
   * Supprimer : confirmation explicite, puis suppression définitive du compte et de ses trades.
   */
  async confirmChoice(choice: LostAccountChoice): Promise<void> {
    const a = this.choiceAccount();
    if (!a || this.busy()) return;
    if (choice === 'delete') {
      await this.purge(a);
      return;
    }
    const status = choice === 'archive' ? 'ARCHIVED' : 'FAILED';
    this.run(this.api.update(a.id, { status }), {
      success: () =>
        choice === 'archive'
          ? `« ${a.label} » archivé : il sort de tes statistiques.`
          : `« ${a.label} » marqué comme échoué : il sort de tes statistiques.`,
      fallback: "Le statut du compte n'a pas pu être enregistré.",
      done: () => this.choiceId.set(null),
    });
  }

  /** « Archiver » sur un compte déjà échoué (Mes comptes). PATCH et non DELETE : un compte sans trade serait supprimé. */
  archive(a: TradingAccount): void {
    if (this.busy()) return;
    this.run(this.api.update(a.id, { status: 'ARCHIVED' }), {
      success: () => `« ${a.label} » archivé.`,
      fallback: "Le compte n'a pas pu être archivé.",
    });
  }

  /** « Créer Apex 50K #2 » : le serveur crée le compte (libellé, quota) ; rien n'est copié de l'ancien. */
  createRetry(): void {
    const a = this.retryAccount();
    if (!a || this.busy()) return;
    this.busy.set(true);
    this.api.retry(a.id).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.retryId.set(null);
        this.store.load();
        this.toast.success(`« ${res.data.label} » créé : il démarre à zéro.`);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.toast.error(apiErrorMessage(err, "La nouvelle tentative n'a pas pu être créée."));
      },
    });
  }

  private async purge(a: TradingAccount): Promise<void> {
    const n = a.metrics?.tradesCount ?? 0;
    const trades = n === 0 ? 'Son journal sera effacé' : `Ses ${n} trade${n > 1 ? 's' : ''} et son journal seront effacés`;
    const ok = await this.confirm.ask({
      title: `Supprimer définitivement « ${a.label} » ?`,
      message: `${trades}, sans retour possible. Ton compte MyTradingCoach et ton abonnement ne changent pas.`,
      confirmLabel: 'Supprimer définitivement',
      danger: true,
    });
    if (!ok) return;
    this.run(this.api.purge(a.id), {
      success: (res) => {
        const deleted = (res as { data?: { tradesDeleted?: number } } | null)?.data?.tradesDeleted ?? n;
        return `« ${a.label} » supprimé · ${deleted} trade${deleted > 1 ? 's' : ''} effacé${deleted > 1 ? 's' : ''}.`;
      },
      fallback: "Le compte n'a pas pu être supprimé.",
      // Déjà absent côté serveur : c'est le but recherché, pas un échec (cf. angular.md).
      notFoundIsSuccess: true,
      done: () => this.choiceId.set(null),
    });
  }

  /** Mutation + rechargement des comptes et des trades (les chiffres changent avec les statuts). */
  private run<T>(
    req$: Observable<T>,
    opts: { success: (res: T | null) => string; fallback: string; done?: () => void; notFoundIsSuccess?: boolean },
  ): void {
    this.busy.set(true);
    const ok = (res: T | null) => {
      this.busy.set(false);
      opts.done?.();
      this.store.load();
      this.tradesStore.reset();
      this.toast.success(opts.success(res));
    };
    req$.subscribe({
      next: (res) => ok(res),
      error: (err: HttpErrorResponse) => {
        if (opts.notFoundIsSuccess && err?.status === 404) {
          ok(null);
          return;
        }
        this.busy.set(false);
        this.toast.error(apiErrorMessage(err, opts.fallback));
      },
    });
  }

  private find(id: string | null): TradingAccount | null {
    return id ? (this.store.accounts().find((a) => a.id === id) ?? null) : null;
  }
}
