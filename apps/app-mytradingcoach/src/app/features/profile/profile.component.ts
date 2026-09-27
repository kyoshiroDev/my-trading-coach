import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  WritableSignal,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, finalize } from 'rxjs/operators';
import {
  LucideDynamicIcon,
  LucidePencil as Pencil,
  LucideArchive as Archive,
  LucideTrash2 as Trash2,
  LucideRotateCcw as RotateCcw,
  LucideChevronDown as ChevronDown,
  LucideChevronRight as ChevronRight,
} from '@lucide/angular';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { PlanModalComponent } from '../../shared/components/plan-modal/plan-modal.component';
import { UserStore } from '../../core/stores/user.store';
import { AuthService } from '../../core/auth/auth.service';
import { BillingApi } from '../../core/api/billing.api';
import { UsersApi } from '../../core/api/users.api';
import type {
  UpdateMeDto,
  UpdatePreferencesDto,
} from '../../core/api/users.api';
import { TRADING_STYLES, SESSIONS } from '../onboarding/onboarding.constants';
import { TradesApi, InstrumentSearchResult, UserAssetItem } from '../../core/api/trades.api';
import { SetupsStore } from '../../core/stores/setups.store';
import { Setup } from '../../core/api/setups.api';
import { AnalyticsApi, SetupStat } from '../../core/api/analytics.api';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage } from '../../core/utils/api-error';
import {
  SetupFormModalComponent,
  SetupFormValue,
  EditableSetup,
} from '../../shared/components/setup-form-modal/setup-form-modal.component';
import { DialogDirective } from '@mtc/front-ui';
import { searchLocalInstruments, sessionLabel, styleEmoji, styleLabel, withAsset, withoutAsset } from './profile.helpers';

type ProfileTab = 'trader' | 'params';

@Component({
  selector: 'mtc-profile',
  imports: [DialogDirective, TopbarComponent, DatePipe, DecimalPipe, PlanModalComponent, SetupFormModalComponent, LucideDynamicIcon],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileComponent implements OnInit {
  protected readonly userStore = inject(UserStore);
  private readonly auth = inject(AuthService);
  private readonly billingApi = inject(BillingApi);
  private readonly usersApi = inject(UsersApi);
  private readonly tradesApi = inject(TradesApi);
  protected readonly setupsStore = inject(SetupsStore);
  private readonly analyticsApi = inject(AnalyticsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  protected readonly checkoutParam = toSignal(
    this.route.queryParamMap.pipe(map((p) => p.get('checkout'))),
  );

  // Onglets Profil trader / Paramètres (deep-link ?tab=params)
  protected readonly activeProfileTab = signal<ProfileTab>('trader');

  // Statut d'essai : N calculé depuis trialEndsAt Stripe, pas l'inscription.
  protected readonly isInTrial = computed(() => {
    const end = this.userStore.user()?.trialEndsAt;
    return !!end && new Date(end).getTime() > Date.now();
  });
  /** Jours restants avant le 1er prélèvement (arrondi au jour supérieur, min 0). */
  protected readonly trialDaysLeft = computed(() => {
    const end = this.userStore.user()?.trialEndsAt;
    if (!end) return 0;
    const ms = new Date(end).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86_400_000));
  });
  protected readonly trialEndsAt = computed(() => this.userStore.user()?.trialEndsAt ?? null);

  // Compte : nom
  protected readonly editingName = signal(false);
  protected readonly nameInput = signal('');
  protected readonly isSavingName = signal(false);

  // Compte : email
  protected readonly editingEmail = signal(false);
  protected readonly emailInput = signal('');
  protected readonly isSavingEmail = signal(false);

  // Compte : mot de passe
  protected readonly passwordResetSent = signal(false);

  // Préférences (plus de devise : elle est portée par chaque compte)
  protected readonly prefNotifications = signal(true);
  protected readonly prefDebrief = signal(true);
  protected readonly prefMarketing = signal(false);
  protected readonly isSavingPrefs = signal(false);
  protected readonly prefSaved = signal(false);

  // Stratégie de trading (résumé en lecture + modale d'édition)
  protected readonly TRADING_STYLES   = TRADING_STYLES;
  protected readonly SESSIONS         = SESSIONS;
  protected readonly tradingStyle     = signal<string | null>(null);
  protected readonly tradingSessions  = signal<string[]>([]);
  protected readonly tradesPerDayMin  = signal(1);
  protected readonly tradesPerDayMax  = signal(10);
  protected readonly strategyDesc     = signal('');
  protected readonly isSavingStrategy = signal(false);

  // Modale stratégie : brouillon (édité dans la modale, annulé sans persistance)
  protected readonly showStrategyModal = signal(false);
  protected readonly draftCapital  = signal('');
  protected readonly draftStyle    = signal<string | null>(null);
  protected readonly draftSessions = signal<string[]>([]);
  protected readonly draftMin      = signal(1);
  protected readonly draftMax      = signal(10);
  protected readonly draftDesc     = signal('');

  protected readonly hasStrategyProfile = computed(() =>
    !!(this.tradingStyle() || this.strategyDesc().trim()),
  );

  // Actifs tradés : auto-save (chaque mutation persiste immédiatement)
  protected readonly tradingAssets = signal<UserAssetItem[]>([]);
  protected readonly assetsSaving = signal(false);
  protected readonly assetSearchQuery = signal('');
  protected readonly assetSearchResults = signal<InstrumentSearchResult[]>([]);
  protected readonly assetSearchLoading = signal(false);
  private searchDebounce?: ReturnType<typeof setTimeout>;

  // Danger
  protected readonly showPlanModal = signal(false);
  protected readonly showDeleteConfirm = signal(false);
  protected readonly deleteInput = signal('');
  protected readonly deleteReason = signal('');
  protected readonly isDeleting = signal(false);
  /**
   * Échec de suppression de compte. Le handler `error` se contentait de relâcher le
   * spinner : l'utilisateur voyait « Suppression… » s'arrêter, puis plus rien, et
   * restait connecté sans savoir pourquoi. Sur une action irréversible qu'il vient de
   * confirmer en tapant SUPPRIMER, le silence est le pire retour possible.
   */
  protected readonly deleteError = signal<string | null>(null);

  // Nettoyage des doublons (maintenance)
  protected readonly duplicateCount = signal<number | null>(null); // null = pas encore analysé
  protected readonly dedupeScanning = signal(false);
  protected readonly dedupeRemoving = signal(false);
  protected readonly dedupeRemoved = signal<number | null>(null);

  constructor() {
    // Sync prefs uniquement : les signaux stratégie sont gérés dans ngOnInit + saveStrategy
    effect(() => {
      const user = this.userStore.user();
      if (!user) return;
      this.prefNotifications.set(user.notificationsEmail ?? true);
      this.prefDebrief.set(user.debriefAutomatic ?? true);
      this.prefMarketing.set(user.marketingConsent ?? false);
    });
  }

  ngOnInit(): void {
    if (this.route.snapshot.queryParamMap.get('checkout') === 'success') {
      this.userStore.refreshUser();
    }
    // Deep-link onglet : ?tab=params ouvre directement l'onglet Paramètres.
    if (this.route.snapshot.queryParamMap.get('tab') === 'params') {
      this.activeProfileTab.set('params');
    }

    // Init stratégie une seule fois au chargement
    const user = this.userStore.user();
    if (user) {
      this.tradingStyle.set(user.tradingStyle ?? null);
      this.tradingSessions.set(user.tradingSessions ?? []);
      this.tradesPerDayMin.set(user.tradesPerDayMin ?? 1);
      this.tradesPerDayMax.set(user.tradesPerDayMax ?? 10);
      this.strategyDesc.set(user.strategyDescription ?? '');
      // Premier passage (profil stratégie vide) → ouvrir directement la modale d'édition.
      if (!this.hasStrategyProfile()) this.openStrategyModal();
    }

    this.tradesApi.getUserAssets().subscribe({
      next: (res) => this.tradingAssets.set(res.data ?? []),
    });

    // Mes setups : liste (store) + win rate par setup (analytics).
    this.setupsStore.load();
    this.analyticsApi.getBySetup()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.setupStats.set(res.data ?? []),
        // `by-setup` est un endpoint Premium : en FREE, le 403 est ATTENDU (le win
        // rate par setup est un bonus, la liste des setups s'affiche sans lui). Sans
        // gestionnaire d'erreur, RxJS le remontait en `ERROR HttpErrorResponse` dans
        // la console — bruit qui masque les vrais problèmes.
        // Toute AUTRE erreur reste visible : on ne filtre que le cas paywall connu.
        error: (err: { status?: number }) => {
          if (err?.status !== 403) {
            console.error('[settings] analytics by-setup indisponible', err);
          }
        },
      });
  }

  // ── Mes setups ──────────────────────────────────────────────────────────────
  protected readonly PencilIcon    = Pencil;
  protected readonly ArchiveIcon   = Archive;
  protected readonly TrashIcon     = Trash2;
  protected readonly RestoreIcon   = RotateCcw;
  protected readonly ChevronDownIcon  = ChevronDown;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly setupStats = signal<SetupStat[]>([]);
  protected readonly showSetupsArchived = signal(false);
  protected readonly showSetupModal = signal(false);
  protected readonly editingSetup = signal<EditableSetup | null>(null);

  /** win rate par setupId (depuis analytics by-setup). */
  protected readonly winRateBySetup = computed(() => {
    const map = new Map<string, number | null>();
    for (const s of this.setupStats()) map.set(s.setupId, s.winRate);
    return map;
  });

  /** Nombre de trades du setup le plus utilisé (échelle de la barre d'usage). */
  protected readonly maxSetupCount = computed(() =>
    Math.max(1, ...this.setupsStore.active().map((s) => s.tradeCount)),
  );

  protected setupUsagePct(count: number): number {
    return Math.round((count / this.maxSetupCount()) * 100);
  }

  /** Couleur du win rate : vert ≥52, rouge <45, neutre sinon. */
  protected winRateClass(setupId: string): 'good' | 'bad' | 'neutral' {
    const wr = this.winRateBySetup().get(setupId);
    if (wr == null) return 'neutral';
    if (wr >= 52) return 'good';
    if (wr < 45) return 'bad';
    return 'neutral';
  }

  protected winRateValue(setupId: string): number | null {
    return this.winRateBySetup().get(setupId) ?? null;
  }

  protected openCreateSetup(): void {
    this.editingSetup.set(null);
    this.showSetupModal.set(true);
  }

  protected openEditSetup(s: Setup): void {
    this.editingSetup.set({ id: s.id, title: s.title, color: s.color, description: s.description });
    this.showSetupModal.set(true);
  }

  protected onSetupSave(value: SetupFormValue): void {
    const editing = this.editingSetup();
    if (editing) {
      this.setupsStore.update(editing.id, value);
    } else {
      this.setupsStore.create(value);
    }
    this.showSetupModal.set(false);
    this.editingSetup.set(null);
  }

  protected archiveSetup(id: string): void { this.setupsStore.archive(id); }
  protected restoreSetup(id: string): void { this.setupsStore.restore(id); }
  protected deleteSetup(id: string): void { this.setupsStore.remove(id); }

  // ── Onglets ───────────────────────────────────────────────────────────────
  protected setProfileTab(tab: ProfileTab): void {
    this.activeProfileTab.set(tab);
    // Met à jour l'URL (merge → conserve ?checkout=…), sans empiler d'historique.
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === 'params' ? 'params' : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected openPortal() {
    this.billingApi
      .portal()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          window.location.href = res.data.url;
        },
        error: (err) => this.toast.error(apiErrorMessage(err, 'L’espace de facturation est indisponible pour le moment.')),
      });
  }

  protected startEditEmail() {
    this.emailInput.set(this.userStore.user()?.email ?? '');
    this.editingEmail.set(true);
  }

  protected saveEmail() {
    const email = this.emailInput().trim();
    if (!email) return;
    this.saveUserField({ email }, this.isSavingEmail, () =>
      this.editingEmail.set(false),
    );
  }

  protected startEditName() {
    this.nameInput.set(this.userStore.user()?.name ?? '');
    this.editingName.set(true);
  }

  protected saveName() {
    const name = this.nameInput().trim();
    if (!name) return;
    this.saveUserField({ name }, this.isSavingName, () =>
      this.editingName.set(false),
    );
  }

  private saveUserField(
    dto: UpdateMeDto,
    loadingSig: WritableSignal<boolean>,
    done: () => void,
  ): void {
    loadingSig.set(true);
    this.usersApi
      .updateMe(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.auth.setCurrentUser(res.data);
          done();
          loadingSig.set(false);
        },
        error: () => loadingSig.set(false),
      });
  }

  protected resetPassword() {
    const user = this.userStore.user();
    if (!user) return;
    this.auth
      .forgotPassword(user.email)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.passwordResetSent.set(true);
          setTimeout(() => this.passwordResetSent.set(false), 4000);
        },
        error: () => {
          /* silently ignore : user stays on page */
        },
      });
  }

  protected savePreferences() {
    this.isSavingPrefs.set(true);
    const dto: UpdatePreferencesDto = {
      notificationsEmail: this.prefNotifications(),
      debriefAutomatic: this.prefDebrief(),
      marketingConsent: this.prefMarketing(),
    };
    this.usersApi
      .updatePreferences(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.auth.setCurrentUser(res.data);
          this.isSavingPrefs.set(false);
          this.prefSaved.set(true);
          setTimeout(() => this.prefSaved.set(false), 2500);
        },
        // AVANT : échec muet, le bouton se réactivait sans rien dire.
        error: (err) => {
          this.isSavingPrefs.set(false);
          this.toast.error(apiErrorMessage(err, 'Tes préférences n’ont pas pu être enregistrées.'));
        },
      });
  }

  // ── Stratégie : modale ──────────────────────────────────────────────────────
  protected openStrategyModal(): void {
    const cap = this.userStore.startingCapital();
    this.draftCapital.set(cap > 0 ? String(cap) : '');
    this.draftStyle.set(this.tradingStyle());
    this.draftSessions.set([...this.tradingSessions()]);
    this.draftMin.set(this.tradesPerDayMin());
    this.draftMax.set(this.tradesPerDayMax());
    this.draftDesc.set(this.strategyDesc());
    this.showStrategyModal.set(true);
  }

  protected closeStrategyModal(): void {
    this.showStrategyModal.set(false);
  }

  protected toggleDraftSession(session: string): void {
    this.draftSessions.update((sessions) =>
      sessions.includes(session) ? sessions.filter((s) => s !== session) : [...sessions, session],
    );
  }

  protected filterDraftCapital(event: Event): void {
    const input = event.target as HTMLInputElement;
    input.value = input.value.replace(/[^\d.,]/g, '');
    this.draftCapital.set(input.value);
  }

  protected onDraftDesc(e: Event): void {
    this.draftDesc.set((e.target as HTMLTextAreaElement).value.slice(0, 200));
  }

  protected saveStrategy(): void {
    this.isSavingStrategy.set(true);
    const raw = this.draftCapital().replace(',', '.');
    const parsed = parseFloat(raw);
    const capital = isNaN(parsed) || parsed < 0 ? 0 : parsed;
    this.usersApi
      .updatePreferences({
        startingCapital:     capital,
        tradingStyle:        this.draftStyle() ?? undefined,
        tradingSessions:     this.draftSessions(),
        tradesPerDayMin:     this.draftMin(),
        tradesPerDayMax:     this.draftMax(),
        strategyDescription: this.draftDesc().trim() || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          // Rafraîchir les signaux du résumé depuis la réponse, puis le store.
          this.tradingStyle.set(res.data.tradingStyle ?? null);
          this.tradingSessions.set(res.data.tradingSessions ?? []);
          this.tradesPerDayMin.set(res.data.tradesPerDayMin ?? 1);
          this.tradesPerDayMax.set(res.data.tradesPerDayMax ?? 10);
          this.strategyDesc.set(res.data.strategyDescription ?? '');
          this.auth.setCurrentUser(res.data);
          this.isSavingStrategy.set(false);
          this.showStrategyModal.set(false);
          this.toast.success('Stratégie enregistrée');
        },
        error: (err) => {
          this.isSavingStrategy.set(false);
          this.toast.error(apiErrorMessage(err, 'Ta stratégie n’a pas pu être enregistrée.'));
        },
      });
  }

  // ── Actifs : recherche + auto-save ─────────────────────────────────────────
  protected onAssetSearch(query: string): void {
    this.assetSearchQuery.set(query.toUpperCase());
    clearTimeout(this.searchDebounce);
    if (!query.trim()) {
      this.assetSearchResults.set([]);
      return;
    }
    this.searchDebounce = setTimeout(() => {
      this.assetSearchLoading.set(true);
      this.tradesApi.searchInstruments(query).subscribe({
        next: (res) => {
          this.assetSearchResults.set(res.data ?? []);
          this.assetSearchLoading.set(false);
        },
        error: () => {
          this.assetSearchResults.set(searchLocalInstruments(query));
          this.assetSearchLoading.set(false);
        },
      });
    }, 400);
  }

  protected addAsset(result: InstrumentSearchResult): void {
    if (this.assetsSaving()) return;
    const prev = this.tradingAssets();
    const next = withAsset(prev, result);
    if (!next) return;
    this.tradingAssets.set(next);
    this.assetSearchQuery.set('');
    this.assetSearchResults.set([]);
    this.persistAssets(prev);
  }

  protected removeAsset(symbol: string): void {
    if (this.assetsSaving()) return;
    const prev = this.tradingAssets();
    this.tradingAssets.set(withoutAsset(prev, symbol));
    this.persistAssets(prev);
  }

  protected setFavoriteAssetSetting(symbol: string): void {
    if (this.assetsSaving()) return;
    const prev = this.tradingAssets();
    this.tradingAssets.set(prev.map((a) => ({ ...a, isFavorite: a.symbol === symbol })));
    this.persistAssets(prev);
  }

  /** Persiste la liste d'actifs + favori. Rollback du signal si l'appel échoue. */
  private persistAssets(prev: UserAssetItem[]): void {
    this.assetsSaving.set(true);
    const symbols = this.tradingAssets().map((a) => a.symbol);
    const fav = this.tradingAssets().find((a) => a.isFavorite)?.symbol ?? null;
    this.tradesApi
      .saveUserAssets(symbols, fav)
      .pipe(
        finalize(() => this.assetsSaving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        error: () => this.tradingAssets.set(prev), // rollback optimiste
      });
  }

  protected confirmDelete() {
    if (this.deleteInput() !== 'SUPPRIMER') return;
    this.isDeleting.set(true);
    this.deleteError.set(null);
    this.usersApi
      .deleteMe(this.deleteReason() || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.auth.logout();
        },
        error: (err) => {
          this.isDeleting.set(false);
          this.deleteError.set(
            err?.error?.message ??
              "Ton compte n'a pas pu être supprimé. Réessaie, et contacte le support si ça persiste.",
          );
        },
      });
  }

  protected scanDuplicates() {
    this.dedupeScanning.set(true);
    this.dedupeRemoved.set(null);
    this.tradesApi
      .getDuplicates()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.duplicateCount.set(res.data.duplicates);
          this.dedupeScanning.set(false);
        },
        error: () => {
          this.dedupeScanning.set(false);
          this.toast.error('La recherche de doublons a échoué. Réessaie.');
        },
      });
  }

  protected removeDuplicates() {
    this.dedupeRemoving.set(true);
    this.tradesApi
      .removeDuplicates()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.dedupeRemoved.set(res.data.removed);
          this.duplicateCount.set(0);
          this.dedupeRemoving.set(false);
        },
        error: (err) => {
          this.dedupeRemoving.set(false);
          this.toast.error(apiErrorMessage(err, 'Les doublons n’ont pas pu être supprimés.'));
        },
      });
  }

  protected readonly styleEmoji = styleEmoji;
  protected readonly styleLabel = styleLabel;
  protected readonly sessionLabel = sessionLabel;
}
