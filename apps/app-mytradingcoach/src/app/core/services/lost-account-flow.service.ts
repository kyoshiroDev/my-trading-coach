import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { ConfirmService } from '@mtc/front-ui';
import { newerAttempt, nextAttemptLabel } from '@mtc/shared';
import { AccountsApi, TradingAccount } from '@app/core/api/accounts.api';
import { SelectedAccountStore } from '@app/core/stores/selected-account.store';
import { TradesStore } from '@app/core/stores/trades.store';
import { ToastService, type ToastAction } from '@app/core/services/toast.service';
import { DemoService } from '@app/core/services/demo.service';
import { UserStore } from '@app/core/stores/user.store';
import { apiErrorMessage } from '@app/core/utils/api-error';

/** Sort d'un compte dont le plancher est atteint (feuille « Apex 50K #1 est échoué »). */
export type LostAccountChoice = 'archive' | 'keep' | 'delete';

/**
 * Compte perdu : feuilles « que faire de ce compte ? » et « nouvelle tentative », ouvertes depuis
 * le bandeau « Plancher atteint », l'alerte live ou Mes comptes, et rendues une seule fois par
 * `mtc-lost-account-sheets` (coque connectée). Les états gardent l'id du compte, jamais l'objet
 * (cf. angular.md). Aucun statut n'est changé sans un clic de l'utilisateur sur « Confirmer ».
 *
 * Démo (lecture seule) : chaque écriture ouvre l'invite « Crée ton compte » au PREMIER clic, sans
 * requête. Seule la feuille de choix reste ouverte, parce qu'elle montre le parcours (archiver,
 * garder, supprimer) : l'invite vient à son « Confirmer ».
 */
@Injectable({ providedIn: 'root' })
export class LostAccountFlowService {
  private readonly api = inject(AccountsApi);
  private readonly store = inject(SelectedAccountStore);
  private readonly tradesStore = inject(TradesStore);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);
  private readonly user = inject(UserStore);
  private readonly demo = inject(DemoService);

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

  /**
   * Tentative plus récente du même compte (« Apex 50K #2 » pour le #1), ou null : « Nouvelle
   * tentative » laisse alors la place à « Voir Apex 50K #2 » (B3).
   */
  newerAttempt(account: Pick<TradingAccount, 'label'>): TradingAccount | null {
    return newerAttempt(account.label, this.store.accounts());
  }

  /** « Voir Apex 50K #2 » : ce compte sélectionné, affiché dans Mes comptes. */
  openAttempt(accountId: string): void {
    this.choiceId.set(null);
    this.retryId.set(null);
    this.store.select(accountId);
    void this.router.navigate(['/accounts']);
  }

  openRetry(accountId: string): void {
    this.choiceId.set(null);
    if (this.blockedInDemo()) return;
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
    if (this.blockedInDemo()) {
      this.choiceId.set(null);
      return;
    }
    if (choice === 'delete') {
      await this.purge(a);
      return;
    }
    const status = choice === 'archive' ? 'ARCHIVED' : 'FAILED';
    // Seule la feuille confirme la limite franchie (#669) : l'autopsie devient réactivable.
    this.run(this.api.update(a.id, { status, confirmIncident: true }), {
      success: () =>
        choice === 'archive'
          ? `« ${a.label} » archivé\u00a0: il sort de tes statistiques.`
          : `« ${a.label} » marqué comme échoué\u00a0: il sort de tes statistiques.`,
      fallback: "Le statut du compte n'a pas pu être enregistré.",
      done: () => this.choiceId.set(null),
      // Autopsie de la séance (#669), créée ou confirmée par le serveur avec ce statut.
      action: { label: "Voir l'autopsie", run: () => this.openAutopsy(a.id) },
    });
  }

  /** « Archiver » sur un compte déjà échoué (Mes comptes). PATCH et non DELETE : un compte sans trade serait supprimé. */
  archive(a: TradingAccount): void {
    if (this.busy() || this.blockedInDemo()) return;
    this.run(this.api.update(a.id, { status: 'ARCHIVED' }), {
      success: () => `« ${a.label} » archivé.`,
      fallback: "Le compte n'a pas pu être archivé.",
    });
  }

  /** « Créer Apex 50K #2 » : le serveur crée le compte (libellé, quota) ; rien n'est copié de l'ancien. */
  createRetry(): void {
    const a = this.retryAccount();
    if (!a || this.busy() || this.blockedInDemo()) return;
    this.busy.set(true);
    this.api.retry(a.id).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.retryId.set(null);
        this.store.load();
        this.toast.success(`« ${res.data.label} » créé\u00a0: il démarre à zéro.`);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        // Déjà créée (autre onglet, double clic) : pas une erreur. La liste rechargée la montre et
        // le bouton devient « Voir Apex 50K #2 ».
        if (err.status === 409 && (err.error as { code?: string } | null)?.code === 'RETRY_EXISTS') {
          this.retryId.set(null);
          this.store.load();
          return;
        }
        this.toast.error(apiErrorMessage(err, "La nouvelle tentative n'a pas pu être créée."));
      },
    });
  }

  private async purge(a: TradingAccount): Promise<void> {
    const n = a.metrics?.tradesCount ?? 0;
    const trades = n === 0 ? 'Son journal sera effacé' : `Ses ${n} trade${n > 1 ? 's' : ''} et son journal seront effacés`;
    const ok = await this.confirm.ask({
      title: `Supprimer définitivement « ${a.label} »\u00a0?`,
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

  /**
   * Bouton « Voir l'autopsie » du toast de confirmation. La feuille de choix ne s'ouvre que sur
   * une limite franchie (bandeau, alerte live) : le serveur a créé ou confirmé l'autopsie avec ce
   * statut. Elle est cherchée au clic ; s'il n'y en a pas, on le dit.
   */
  private openAutopsy(accountId: string): void {
    this.api.incidents(accountId).subscribe({
      next: (res) => {
        const latest = res.data?.[0];
        if (latest) void this.router.navigate(['/accounts', accountId, 'autopsie', latest.id]);
        else this.toast.info("Pas d'autopsie pour ce compte\u00a0: aucune limite franchie n'a été relevée sur ses trades.");
      },
      error: (err: HttpErrorResponse) => this.toast.error(apiErrorMessage(err, "L'autopsie n'a pas pu être ouverte.")),
    });
  }

  /** Mutation + rechargement des comptes et des trades (les chiffres changent avec les statuts). */
  private run<T>(
    req$: Observable<T>,
    opts: {
      success: (res: T | null) => string;
      fallback: string;
      done?: () => void;
      notFoundIsSuccess?: boolean;
      /** Bouton facultatif du toast de succès. */
      action?: ToastAction;
    },
  ): void {
    this.busy.set(true);
    const ok = (res: T | null) => {
      this.busy.set(false);
      opts.done?.();
      this.store.load();
      this.tradesStore.reset();
      this.toast.success(opts.success(res), opts.action ? { action: opts.action } : undefined);
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

  /** Démo : ouvre l'invite « Crée ton compte » à la place de l'écriture, et le signale. */
  private blockedInDemo(): boolean {
    if (!this.user.isDemo()) return false;
    this.demo.promptSignup();
    return true;
  }

  private find(id: string | null): TradingAccount | null {
    return id ? (this.store.accounts().find((a) => a.id === id) ?? null) : null;
  }
}
