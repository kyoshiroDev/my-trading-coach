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
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, finalize } from 'rxjs/operators';
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
import { TRADING_STYLES, STRATEGY_TAGS, SESSIONS } from '../onboarding/onboarding.constants';
import { TradesApi, InstrumentSearchResult, UserAssetItem } from '../../core/api/trades.api';

@Component({
  selector: 'mtc-settings',
  standalone: true,
  imports: [TopbarComponent, DatePipe, DecimalPipe, PlanModalComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent implements OnInit {
  protected readonly userStore = inject(UserStore);
  private readonly auth = inject(AuthService);
  private readonly billingApi = inject(BillingApi);
  private readonly usersApi = inject(UsersApi);
  private readonly tradesApi = inject(TradesApi);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly checkoutParam = toSignal(
    this.route.queryParamMap.pipe(map((p) => p.get('checkout'))),
  );

  // Compte — nom
  protected readonly editingName = signal(false);
  protected readonly nameInput = signal('');
  protected readonly isSavingName = signal(false);

  // Compte — email
  protected readonly editingEmail = signal(false);
  protected readonly emailInput = signal('');
  protected readonly isSavingEmail = signal(false);

  // Compte — mot de passe
  protected readonly passwordResetSent = signal(false);

  // Compte — capital de départ
  protected readonly editingCapital = signal(false);
  protected readonly capitalInput = signal('');
  protected readonly isSavingCapital = signal(false);

  // Préférences
  protected readonly prefCurrency = signal<'USD' | 'EUR' | 'GBP'>('USD');
  protected readonly prefNotifications = signal(true);
  protected readonly prefDebrief = signal(true);
  protected readonly isSavingPrefs = signal(false);
  protected readonly prefSaved = signal(false);

  // Stratégie de trading
  protected readonly TRADING_STYLES   = TRADING_STYLES;
  protected readonly STRATEGY_TAGS    = STRATEGY_TAGS;
  protected readonly SESSIONS         = SESSIONS;
  protected readonly tradingStyle     = signal<string | null>(null);
  protected readonly tradingStrategy  = signal<string[]>([]);
  protected readonly tradingSessions  = signal<string[]>([]);
  protected readonly tradesPerDayMin  = signal(1);
  protected readonly tradesPerDayMax  = signal(10);
  protected readonly strategyDesc     = signal('');
  protected readonly isSavingStrategy = signal(false);
  protected readonly strategySaved    = signal(false);
  protected readonly editingStrategy  = signal(false);

  protected readonly hasStrategyProfile = computed(() =>
    !!(
      this.tradingStyle() ||
      this.tradingStrategy().length > 0 ||
      this.strategyDesc().trim()
    ),
  );

  // Actifs tradés
  protected readonly tradingAssets = signal<UserAssetItem[]>([]);
  protected readonly isSavingAssets = signal(false);
  protected readonly assetsSaved = signal(false);
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

  // Nettoyage des doublons (maintenance)
  protected readonly duplicateCount = signal<number | null>(null); // null = pas encore analysé
  protected readonly dedupeScanning = signal(false);
  protected readonly dedupeRemoving = signal(false);
  protected readonly dedupeRemoved = signal<number | null>(null);

  constructor() {
    // Sync prefs uniquement — les signaux stratégie sont gérés dans ngOnInit + saveStrategy
    effect(() => {
      const user = this.userStore.user();
      if (!user) return;
      this.prefCurrency.set((user.currency as 'USD' | 'EUR' | 'GBP') ?? 'USD');
      this.prefNotifications.set(user.notificationsEmail ?? true);
      this.prefDebrief.set(user.debriefAutomatic ?? true);
    });
  }

  ngOnInit(): void {
    if (this.route.snapshot.queryParamMap.get('checkout') === 'success') {
      this.userStore.refreshUser();
    }
    // Init stratégie une seule fois au chargement
    const user = this.userStore.user();
    if (user) {
      this.tradingStyle.set(user.tradingStyle ?? null);
      this.tradingStrategy.set(user.tradingStrategy ?? []);
      this.tradingSessions.set(user.tradingSessions ?? []);
      this.tradesPerDayMin.set(user.tradesPerDayMin ?? 1);
      this.tradesPerDayMax.set(user.tradesPerDayMax ?? 10);
      this.strategyDesc.set(user.strategyDescription ?? '');
      // Vue résumé si profil déjà renseigné, formulaire sinon
      const hasProfil = !!(
        user.tradingStyle ||
        (user.tradingStrategy?.length ?? 0) > 0 ||
        user.strategyDescription
      );
      this.editingStrategy.set(!hasProfil);
    }

    this.tradesApi.getUserAssets().subscribe({
      next: (res) => this.tradingAssets.set(res.data ?? []),
    });
  }

  protected startTrial(plan: 'starter_monthly' | 'starter_yearly' = 'starter_monthly') {
    this.billingApi
      .checkout(plan)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          window.location.href = res.data.url;
        },
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
          /* silently ignore — user stays on page */
        },
      });
  }

  protected startEditCapital() {
    const current = this.userStore.startingCapital();
    this.capitalInput.set(current > 0 ? String(current) : '');
    this.editingCapital.set(true);
  }

  protected filterCapital(event: Event): void {
    const input = event.target as HTMLInputElement;
    input.value = input.value.replace(/[^\d.,]/g, '');
    this.capitalInput.set(input.value);
  }

  protected saveCapital() {
    const raw = this.capitalInput().replace(',', '.');
    const parsed = parseFloat(raw);
    const capital = isNaN(parsed) || parsed < 0 ? 0 : parsed;
    this.isSavingCapital.set(true);
    this.usersApi
      .updatePreferences({ startingCapital: capital })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.auth.setCurrentUser(res.data);
          this.isSavingCapital.set(false);
          this.editingCapital.set(false);
        },
        error: () => {
          this.isSavingCapital.set(false);
        },
      });
  }

  protected savePreferences() {
    this.isSavingPrefs.set(true);
    const dto: UpdatePreferencesDto = {
      currency: this.prefCurrency(),
      notificationsEmail: this.prefNotifications(),
      debriefAutomatic: this.prefDebrief(),
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
        error: () => {
          this.isSavingPrefs.set(false);
        },
      });
  }

  protected toggleTag(tag: string): void {
    this.tradingStrategy.update(tags =>
      tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag],
    );
  }

  protected toggleSession(session: string): void {
    this.tradingSessions.update(sessions =>
      sessions.includes(session) ? sessions.filter(s => s !== session) : [...sessions, session],
    );
  }

  protected onStrategyDesc(e: Event): void {
    this.strategyDesc.set((e.target as HTMLTextAreaElement).value.slice(0, 200));
  }

  protected saveStrategy(): void {
    this.isSavingStrategy.set(true);
    this.usersApi
      .updatePreferences({
        tradingStyle:        this.tradingStyle() ?? undefined,
        tradingStrategy:     this.tradingStrategy(),
        tradingSessions:     this.tradingSessions(),
        tradesPerDayMin:     this.tradesPerDayMin(),
        tradesPerDayMax:     this.tradesPerDayMax(),
        strategyDescription: this.strategyDesc() || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          // Mettre à jour les signaux stratégie depuis la réponse avant setCurrentUser
          this.tradingStyle.set(res.data.tradingStyle ?? null);
          this.tradingStrategy.set(res.data.tradingStrategy ?? []);
          this.tradingSessions.set(res.data.tradingSessions ?? []);
          this.tradesPerDayMin.set(res.data.tradesPerDayMin ?? 1);
          this.tradesPerDayMax.set(res.data.tradesPerDayMax ?? 10);
          this.strategyDesc.set(res.data.strategyDescription ?? '');
          this.auth.setCurrentUser(res.data);
          this.isSavingStrategy.set(false);
          this.editingStrategy.set(false);
        },
        error: () => this.isSavingStrategy.set(false),
      });
  }

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
          this.assetSearchResults.set(this.searchLocalFallback(query));
          this.assetSearchLoading.set(false);
        },
      });
    }, 400);
  }

  private searchLocalFallback(query: string): InstrumentSearchResult[] {
    const QUICK_LIST: InstrumentSearchResult[] = [
      { symbol: 'NQ',  label: 'E-mini Nasdaq (NQ)',              category: 'FUTURES' },
      { symbol: 'MNQ', label: 'Micro E-mini Nasdaq (MNQ)',       category: 'FUTURES' },
      { symbol: 'ES',  label: 'E-mini S&P 500 (ES)',             category: 'FUTURES' },
      { symbol: 'MES', label: 'Micro E-mini S&P 500 (MES)',      category: 'FUTURES' },
      { symbol: 'YM',  label: 'E-mini Dow Jones (YM)',           category: 'FUTURES' },
      { symbol: 'RTY', label: 'E-mini Russell 2000 (RTY)',       category: 'FUTURES' },
      { symbol: 'GC',  label: 'Gold Futures (GC)',               category: 'FUTURES' },
      { symbol: 'CL',  label: 'Crude Oil Futures (CL)',          category: 'FUTURES' },
      { symbol: 'MBT', label: 'Micro Bitcoin CME (MBT)',         category: 'FUTURES' },
      { symbol: 'BTC', label: 'Bitcoin Futures CME (BTC)',       category: 'FUTURES' },
      { symbol: 'MET', label: 'Micro Ether CME (MET)',           category: 'FUTURES' },
      { symbol: 'ETH', label: 'Ether Futures CME (ETH)',         category: 'FUTURES' },
      { symbol: 'BTC/USDT', label: 'Bitcoin Spot (BTC/USDT)',   category: 'CRYPTO' },
      { symbol: 'ETH/USDT', label: 'Ethereum Spot (ETH/USDT)', category: 'CRYPTO' },
      { symbol: 'EUR/USD',  label: 'Euro / Dollar (EUR/USD)',   category: 'FOREX' },
      { symbol: 'GBP/USD',  label: 'Livre / Dollar (GBP/USD)', category: 'FOREX' },
    ];
    const q = query.toLowerCase();
    return QUICK_LIST.filter(
      (i) => i.symbol.toLowerCase().includes(q) || i.label.toLowerCase().includes(q),
    ).slice(0, 8);
  }

  protected addAsset(result: InstrumentSearchResult): void {
    const normalized: InstrumentSearchResult = { ...result, symbol: result.symbol.toUpperCase().trim() };
    if (this.tradingAssets().some((a) => a.symbol === normalized.symbol)) return;
    const isFirst = this.tradingAssets().length === 0;
    const newAsset: UserAssetItem = {
      symbol: normalized.symbol,
      label: normalized.label,
      category: normalized.category,
      isFavorite: isFirst,
      tradeCount: 0,
      lastEntry: null,
      lastQty: null,
    };
    this.tradingAssets.update((assets) => [...assets, newAsset]);
    if (isFirst) {
      this.tradesApi.setFavoriteAsset(normalized.symbol).subscribe();
    }
    this.assetSearchQuery.set('');
    this.assetSearchResults.set([]);
  }

  protected removeAsset(symbol: string): void {
    this.tradingAssets.update((assets) => assets.filter((a) => a.symbol !== symbol));
  }

  protected setFavoriteAssetSetting(symbol: string): void {
    this.tradingAssets.update((assets) =>
      assets.map((a) => ({ ...a, isFavorite: a.symbol === symbol })),
    );
  }

  protected saveAssets(): void {
    this.isSavingAssets.set(true);
    this.assetsSaved.set(false);
    const symbols = this.tradingAssets().map((a) => a.symbol);
    const fav = this.tradingAssets().find((a) => a.isFavorite)?.symbol ?? null;
    this.tradesApi
      .saveUserAssets(symbols, fav)
      .pipe(finalize(() => this.isSavingAssets.set(false)))
      .subscribe({
        next: () => {
          this.assetsSaved.set(true);
          setTimeout(() => this.assetsSaved.set(false), 2500);
        },
      });
  }

  protected confirmDelete() {
    if (this.deleteInput() !== 'SUPPRIMER') return;
    this.isDeleting.set(true);
    this.usersApi
      .deleteMe(this.deleteReason() || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.auth.logout();
        },
        error: () => {
          this.isDeleting.set(false);
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
        error: () => this.dedupeScanning.set(false),
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
        error: () => this.dedupeRemoving.set(false),
      });
  }

  protected styleEmoji(style: string | null): string {
    const map: Record<string, string> = {
      SCALPING: '⚡', DAY_TRADING: '📅', SWING: '🌊', POSITION: '🏔️',
    };
    return style ? (map[style] ?? '📈') : '📈';
  }

  protected styleLabel(style: string | null): string {
    const map: Record<string, string> = {
      SCALPING: 'Scalping', DAY_TRADING: 'Day Trading',
      SWING: 'Swing Trading', POSITION: 'Long terme',
    };
    return style ? (map[style] ?? style) : '';
  }

  protected sessionLabel(s: string): string {
    const map: Record<string, string> = {
      LONDON: 'London', NEW_YORK: 'New York', ASIAN: 'Asian',
    };
    return map[s] ?? s;
  }
}
