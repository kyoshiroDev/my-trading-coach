import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LucideDynamicIcon, LucideZap as Zap } from '@lucide/angular';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { CreateTradeDto, InstrumentSearchResult, TradesApi, UserAssetItem } from '../../../../../../core/api/trades.api';
import { SetupsStore } from '../../../../../../core/stores/setups.store';
import { ToastService } from '../../../../../../core/services/toast.service';
import { parseDecimal } from '../../../../../../core/utils/parse-decimal';
import { NumericInputDirective } from '../../../../../../core/directives/numeric-input.directive';
import { POLLING_MS } from '../../../../../../core/constants/polling.const';
import type { EmotionState, TradeSide } from '@mtc/shared';

const EMOTIONS = [
  { value: 'CONFIDENT', emoji: '😎', title: 'Confiant' },
  { value: 'FOCUSED',   emoji: '🎯', title: 'Focalisé' },
  { value: 'NEUTRAL',   emoji: '😐', title: 'Neutre' },
  { value: 'STRESSED',  emoji: '😰', title: 'Stressé' },
  { value: 'FEAR',      emoji: '😨', title: 'Peur' },
  { value: 'REVENGE',   emoji: '🤬', title: 'Revenge' },
] as const;

/**
 * Trade rapide de la session live : actif (liste perso ou saisie libre), prix temps réel,
 * direction, émotion, setup. L'entrée est capturée au prix marché au moment du clic.
 */
@Component({
  selector: 'mtc-quick-trade',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideDynamicIcon, NumericInputDirective],
  templateUrl: './quick-trade.component.html',
  styleUrl: './quick-trade.component.css',
})
export class QuickTradeComponent {
  readonly tradeLogged = output<CreateTradeDto>();

  private readonly destroyRef = inject(DestroyRef);
  private readonly tradesApi = inject(TradesApi);
  protected readonly setupsStore = inject(SetupsStore);
  private readonly toast = inject(ToastService);

  protected readonly QuickIcon = Zap;
  protected readonly emotions = EMOTIONS;

  // Quick trade form : asset selection
  protected readonly userAssets = signal<UserAssetItem[]>([]);
  protected readonly assetsLoading = signal(false);
  protected readonly assetsError = signal(false);
  protected readonly qtSelectedAsset = signal<UserAssetItem | null>(null);
  // Saisie libre d'actif (anti-blocage premier trade)
  protected readonly customAssetMode    = signal(false);
  protected readonly customAssetQuery   = signal('');
  protected readonly customAssetResults = signal<InstrumentSearchResult[]>([]);
  /** Issue de la dernière recherche (≥ 2 caractères) : `null` tant qu'aucune n'a abouti. */
  protected readonly customAssetSearchStatus = signal<'found' | 'none' | 'unavailable' | null>(null);
  private readonly customAssetSearch$   = new Subject<string>();
  protected readonly qtSide = signal<TradeSide>('LONG');
  protected readonly qtEmotion = signal<EmotionState>('CONFIDENT');
  protected readonly qtSetup = signal<string>('');
  protected readonly qtTimeframe = signal<string>('5m');
  protected readonly qtQty = signal('1');
  protected readonly qtSl = signal('');
  protected readonly qtTp = signal('');
  protected readonly qtSubmitting = signal(false);

  // Prix temps réel FMP
  protected readonly livePrice = signal<number | null>(null);
  protected readonly livePriceLoading = signal(false);
  private livePriceInterval?: ReturnType<typeof setInterval>;

  protected readonly livePricePlaceholder = computed(() => {
    const price = this.livePrice();
    if (price === null) return '0.00';
    const symbol = this.qtSelectedAsset()?.symbol ?? '';
    const dec = ((symbol.includes('/') && !symbol.includes('USDT')) || price < 10) ? 4 : 2;
    // Milliers espace + décimale point (fidélité maquette : « 20 142.25 »)
    return price.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).replace(',', '.');
  });

  protected readonly canSubmitQuickTrade = computed(
    () => this.qtSelectedAsset() !== null,
  );

  constructor() {
    // Setups du user pour le sélecteur de trade rapide. Le choix est REVALIDÉ à
    // chaque changement de la liste active, jamais figé : le compagnon de session
    // vit des heures, et un setup supprimé/archivé entre-temps laissait sinon
    // `qtSetup` sur un id fantôme → 400 sur chaque trade rapide loggé (même défaut
    // que l'import CSV, PROMPT-182). Écriture dans `untracked` pour ne pas boucler.
    this.setupsStore.load();
    effect(() => {
      const active = this.setupsStore.active();
      untracked(() => {
        if (this.qtSetup() && active.some((s) => s.id === this.qtSetup())) return;
        this.qtSetup.set(active[0]?.id ?? '');
      });
    });

    this.loadUserAssets();

    // Recherche d'instrument (saisie libre d'actif)
    this.customAssetSearch$
      .pipe(
        debounceTime(300),
        map((q) => q.trim()),
        distinctUntilChanged(),
        switchMap((q) =>
          q.length < 2
            ? of(null)
            : this.tradesApi.searchInstruments(q).pipe(
                map((res) => res.data ?? []),
                catchError(() => of('unavailable' as const)),
              ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.customAssetResults.set(Array.isArray(res) ? res : []);
        this.customAssetSearchStatus.set(res === null ? null : res === 'unavailable' ? 'unavailable' : res.length ? 'found' : 'none');
      });

    // Arrêter le polling prix au destroy
    this.destroyRef.onDestroy(() => this.stopLivePricePolling());
  }

  protected loadUserAssets(): void {
    this.assetsLoading.set(true);
    this.assetsError.set(false);
    this.tradesApi.getUserAssets()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const assets = res.data ?? [];
          this.userAssets.set(assets);
          const preselect = assets.find((a) => a.isFavorite) ?? assets[0] ?? null;
          if (preselect) this.applyAssetSelection(preselect);
          this.assetsLoading.set(false);
        },
        error: () => {
          this.assetsError.set(true);
          this.assetsLoading.set(false);
        },
      });
  }

  protected onAssetSelect(event: Event): void {
    const symbol = (event.target as HTMLSelectElement).value;
    if (symbol === '__custom__') {
      this.customAssetMode.set(true);
      this.customAssetQuery.set('');
      this.customAssetResults.set([]);
      this.customAssetSearchStatus.set(null);
      return;
    }
    const asset = this.userAssets().find((a) => a.symbol === symbol) ?? null;
    this.qtSelectedAsset.set(asset);
    if (asset) this.applyAssetSelection(asset);
  }

  protected onCustomAssetSearch(event: Event): void {
    const v = (event.target as HTMLInputElement).value;
    this.customAssetQuery.set(v);
    this.customAssetSearch$.next(v);
  }

  protected submitCustomAsset(): void {
    const q = this.customAssetQuery().trim();
    if (q) this.addCustomAsset(q);
  }

  protected cancelCustomAsset(): void {
    this.customAssetMode.set(false);
    this.customAssetQuery.set('');
    this.customAssetResults.set([]);
    this.customAssetSearchStatus.set(null);
  }

  /** Ajoute un actif saisi librement : local immédiat + persistance, sélectionné pour le trade. */
  protected addCustomAsset(symbol: string): void {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;

    let asset = this.userAssets().find((a) => a.symbol === sym) ?? null;
    if (!asset) {
      asset = {
        symbol: sym, label: sym, category: '',
        tradeCount: 0, lastEntry: null, lastQty: null, isFavorite: false,
      };
      this.userAssets.update((list) => [asset as UserAssetItem, ...list]);
    }

    this.applyAssetSelection(asset);
    this.cancelCustomAsset();

    // Persister la liste d'actifs (ne pas bloquer en cas d'erreur réseau)
    const symbols = this.userAssets().map((a) => a.symbol);
    const fav = this.userAssets().find((a) => a.isFavorite)?.symbol ?? null;
    this.tradesApi.saveUserAssets(symbols, fav)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: () => undefined, error: () => undefined });
  }

  private applyAssetSelection(asset: UserAssetItem): void {
    this.qtSelectedAsset.set(asset);
    // L'entry est capturée automatiquement au clic (prix marché de l'instant) : pas de saisie.
    if (asset.lastQty != null) this.qtQty.set(String(asset.lastQty));
    this.startLivePricePolling(asset.symbol);
  }

  private fetchLivePrice(symbol: string): void {
    if (!symbol) { this.livePrice.set(null); return; }
    this.livePriceLoading.set(true);
    this.tradesApi.getLivePrice(symbol).subscribe({
      next: (res) => {
        this.livePrice.set(res.data?.price ?? null);
        this.livePriceLoading.set(false);
      },
      error: () => {
        this.livePrice.set(null);
        this.livePriceLoading.set(false);
      },
    });
  }

  private startLivePricePolling(symbol: string): void {
    this.stopLivePricePolling();
    this.livePrice.set(null);
    this.fetchLivePrice(symbol);
    this.livePriceInterval = setInterval(() => {
      // Garde-fou : pas d'appels quand l'onglet est masqué
      if (!document.hidden) this.fetchLivePrice(symbol);
    }, POLLING_MS.LIVE_PRICE);
  }

  private stopLivePricePolling(): void {
    if (this.livePriceInterval) {
      clearInterval(this.livePriceInterval);
      this.livePriceInterval = undefined;
    }
  }

  protected setFavorite(): void {
    const asset = this.qtSelectedAsset();
    if (!asset) return;
    const newFav = asset.isFavorite ? null : asset.symbol;
    this.tradesApi.setFavoriteAsset(newFav).subscribe({
      next: () => {
        this.userAssets.update((list) =>
          list.map((a) => ({ ...a, isFavorite: a.symbol === newFav })),
        );
        this.qtSelectedAsset.update((a) =>
          a ? { ...a, isFavorite: !a.isFavorite } : null,
        );
      },
      // AVANT : échec muet, l'étoile ne changeait pas sans explication.
      error: () => this.toast.error('Favori non enregistré. Réessaie.'),
    });
  }

  protected submitQuickTrade(): void {
    const selected = this.qtSelectedAsset();
    if (!selected || this.qtSubmitting()) return;

    this.qtSubmitting.set(true);
    // Capture FRAÎCHE du prix au moment exact du clic (cache backend 3s).
    this.tradesApi
      .getLivePrice(selected.symbol)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.emitTrade(selected, res.data?.price ?? this.livePrice() ?? 0);
          this.qtSubmitting.set(false);
        },
        error: () => {
          // Fallback : dernier prix affiché (ne pas bloquer le log)
          this.emitTrade(selected, this.livePrice() ?? 0);
          this.qtSubmitting.set(false);
        },
      });
  }

  private emitTrade(selected: UserAssetItem, entry: number): void {
    const h = new Date().getHours();
    let session: CreateTradeDto['session'];
    if (h >= 7 && h < 16) session = 'LONDON';
    else if (h >= 14 && h < 22) session = 'NEW_YORK';
    else session = 'ASIAN';

    // Normalisation virgule → point avant envoi (champs filtrés par mtcNumericInput).
    const qty = parseDecimal(this.qtQty());
    const sl = parseDecimal(this.qtSl());
    const tp = parseDecimal(this.qtTp());

    const dto: CreateTradeDto = {
      asset: selected.symbol,
      side: this.qtSide(),
      emotion: this.qtEmotion(),
      setupId: this.qtSetup(),
      session,
      timeframe: this.qtTimeframe(),
      entry,
      ...(qty != null ? { quantity: qty } : {}),
      ...(sl != null ? { stopLoss: sl } : {}),
      ...(tp != null ? { takeProfit: tp } : {}),
    };

    this.tradeLogged.emit(dto);
    this.qtSl.set('');
    this.qtTp.set('');
    this.qtQty.set('1');
  }
}
