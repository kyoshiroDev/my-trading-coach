import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { UsersApi } from '../../core/api/users.api';
import { TradesApi, CreateTradeDto, InstrumentSearchResult } from '../../core/api/trades.api';
import { TradesStore } from '../../core/stores/trades.store';
import { AuthService } from '../../core/auth/auth.service';
import { LucideAngularModule, Bitcoin } from 'lucide-angular';
import { TradeFormComponent } from '../journal/trade-form.component';
import { CsvImportComponent } from '../journal/csv-import.component';
import { SetupsStore } from '../../core/stores/setups.store';
import {
  SetupFormModalComponent,
  SetupFormValue,
} from '../../shared/components/setup-form-modal/setup-form-modal.component';
import {
  TRADING_STYLES,
  SESSIONS,
  ASSET_SUGGESTIONS,
  TradingStyle,
  TradingSession,
} from './onboarding.constants';

type Market = 'CRYPTO' | 'FOREX' | 'ACTIONS' | 'MULTI';
type Goal   = 'DISCIPLINE' | 'PERFORMANCE' | 'PSYCHOLOGIE';
type Step   = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

type MarketOption = {
  value: Market;
  label: string;
  emoji?: string;
  icon?: typeof Bitcoin;
  iconColor?: string;
  desc: string;
};

const MARKETS: MarketOption[] = [
  { value: 'CRYPTO',  label: 'Crypto',          icon: Bitcoin, iconColor: '#F7931A', desc: 'Bitcoin, Ethereum, altcoins' },
  { value: 'FOREX',   label: 'Forex',            emoji: '💱',                        desc: 'EUR/USD, paires de devises' },
  { value: 'ACTIONS', label: 'Actions',          emoji: '📈',                        desc: 'Actions, ETF, indices' },
  { value: 'MULTI',   label: 'Multi-marchés',    emoji: '🌐',                        desc: 'Je trade plusieurs marchés' },
];

const GOALS: { value: Goal; label: string; emoji: string; desc: string }[] = [
  { value: 'DISCIPLINE',  label: 'Travailler ma discipline',  emoji: '🎯', desc: 'Respecter mon plan et éviter les trades impulsifs' },
  { value: 'PSYCHOLOGIE', label: 'Maîtriser ma psychologie',  emoji: '🧠', desc: 'Gérer mes émotions, éviter FOMO et revenge trades' },
  { value: 'PERFORMANCE', label: 'Améliorer ma performance',  emoji: '📈', desc: 'Optimiser mon win rate et ma rentabilité globale' },
];

const DISCORD_URL = 'https://discord.gg/TDK2npvkSN';

@Component({
  selector: 'mtc-onboarding',
  standalone: true,
  imports: [LucideAngularModule, TradeFormComponent, CsvImportComponent, SetupFormModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.css',
})
export class OnboardingComponent {
  completed = output<void>();

  private readonly usersApi    = inject(UsersApi);
  private readonly tradesApi   = inject(TradesApi);
  private readonly tradesStore = inject(TradesStore);
  protected readonly setupsStore = inject(SetupsStore);
  private readonly auth        = inject(AuthService);
  private readonly destroyRef  = inject(DestroyRef);

  // Étape Tes setups (les 6 défauts sont seedés au signup).
  protected readonly showSetupModal = signal(false);
  protected readonly setupMsg = signal<string | null>(null);

  protected readonly MARKETS        = MARKETS;
  protected readonly GOALS          = GOALS;
  protected readonly TRADING_STYLES = TRADING_STYLES;
  protected readonly SESSIONS       = SESSIONS;
  protected readonly discordUrl     = DISCORD_URL;

  protected readonly step         = signal<Step>(1);
  protected readonly tradeChoice  = signal<'choice'|'manual'|'csv'>('choice');
  protected readonly csvOpen      = signal(false);
  protected readonly selectedMarket   = signal<Market | null>(null);
  protected readonly selectedGoal     = signal<Goal | null>(null);
  protected readonly selectedCurrency = signal<'USD' | 'EUR'>('USD');
  protected readonly capitalInput     = signal('');
  protected readonly isSaving         = signal(false);

  // Étape Stratégie
  protected readonly selectedStyle        = signal<TradingStyle | null>(null);
  protected readonly strategyDescription  = signal('');
  protected readonly selectedSessions     = signal<TradingSession[]>([]);
  // Stratégie : style + ≥1 session + description ≥ 15 caractères (contexte IA exploitable).
  // Les tags d'approche ont été retirés (redondants avec les setups + la description libre).
  protected readonly strategyValid = computed(
    () =>
      !!this.selectedStyle() &&
      this.selectedSessions().length > 0 &&
      this.strategyDescription().trim().length >= 15,
  );

  // Étape Actifs
  protected readonly selectedAssets = signal<string[]>([]);
  protected readonly favoriteAsset  = signal<string | null>(null);
  protected readonly assetQuery     = signal('');
  protected readonly assetResults   = signal<InstrumentSearchResult[]>([]);
  private readonly assetSearch$     = new Subject<string>();
  protected readonly assetSuggestions = computed(
    () => ASSET_SUGGESTIONS[this.selectedMarket() ?? 'MULTI'] ?? ASSET_SUGGESTIONS['MULTI'],
  );
  protected readonly assetsValid = computed(() => this.selectedAssets().length > 0);

  constructor() {
    this.setupsStore.load();
    this.assetSearch$
      .pipe(
        debounceTime(300),
        map((q) => q.trim()),
        distinctUntilChanged(),
        switchMap((q) =>
          q.length < 2
            ? of({ data: [] as InstrumentSearchResult[] })
            : this.tradesApi.searchInstruments(q).pipe(catchError(() => of({ data: [] as InstrumentSearchResult[] }))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => this.assetResults.set(res.data ?? []));
  }

  protected selectMarket(m: Market)          { this.selectedMarket.set(m); }
  protected selectGoal(g: Goal)              { this.selectedGoal.set(g); }
  protected selectCurrency(c: 'USD'|'EUR')   { this.selectedCurrency.set(c); }

  // ── Stratégie ──
  protected selectStyle(s: TradingStyle)     { this.selectedStyle.set(s); }
  protected toggleSession(s: TradingSession): void {
    this.selectedSessions.update((arr) =>
      arr.includes(s) ? arr.filter((x) => x !== s) : [...arr, s],
    );
  }
  protected onStrategyDescription(event: Event): void {
    this.strategyDescription.set((event.target as HTMLTextAreaElement).value);
  }

  // ── Actifs ──
  protected addAsset(symbol: string): void {
    const s = symbol.trim().toUpperCase();
    if (!s) return;
    this.selectedAssets.update((list) => {
      if (list.includes(s) || list.length >= 3) return list;
      return [...list, s];
    });
    if (this.favoriteAsset() === null && this.selectedAssets().includes(s)) {
      this.favoriteAsset.set(s);
    }
    this.assetQuery.set('');
    this.assetResults.set([]);
  }
  protected removeAsset(symbol: string): void {
    this.selectedAssets.update((list) => list.filter((s) => s !== symbol));
    if (this.favoriteAsset() === symbol) {
      this.favoriteAsset.set(this.selectedAssets()[0] ?? null);
    }
  }
  protected setFavoriteAsset(symbol: string) { this.favoriteAsset.set(symbol); }
  protected onAssetSearch(event: Event): void {
    const v = (event.target as HTMLInputElement).value;
    this.assetQuery.set(v);
    this.assetSearch$.next(v);
  }
  protected submitAssetQuery(): void {
    const q = this.assetQuery().trim();
    if (q) this.addAsset(q);
  }

  protected filterCapital(event: Event): void {
    const input = event.target as HTMLInputElement;
    input.value = input.value.replace(/[^\d.,]/g, '');
    this.capitalInput.set(input.value);
  }

  // Capital obligatoire : « Continuer » bloqué tant que > 0 n'est pas saisi.
  protected readonly capitalValid = computed(() => this.parseCapital() > 0);

  protected nextStep(): void {
    const s = this.step();
    if (s === 5) {
      this.saveProfileThenGoAssets();        // Stratégie → profil IA enregistré → Actifs
    } else if (s === 6) {
      this.saveAssetsThenGoTrade();          // Actifs enregistrés → étape Setups (7)
    } else if (s < 9) {
      this.step.set((s + 1) as Step);        // ex. Setups (7) → premier trade (8)
    }
  }

  protected prevStep(): void {
    const s = this.step();
    if (s === 8) { this.tradeChoice.set('choice'); this.step.set(7); } // premier trade → Setups
    else if (s > 1 && s < 9) { this.step.set((s - 1) as Step); }
  }

  protected chooseManual() { this.tradeChoice.set('manual'); }
  protected chooseCsv()    { this.tradeChoice.set('csv'); this.csvOpen.set(true); }
  protected backToChoice() { this.tradeChoice.set('choice'); this.csvOpen.set(false); }

  protected finishAndGoDiscord() { this.step.set(9); }

  // ── Étape Tes setups (7) — réutilise la modale partagée + SetupsStore ──
  protected openSetupModal(): void { this.setupMsg.set(null); this.showSetupModal.set(true); }
  protected onSetupSave(value: SetupFormValue): void {
    this.showSetupModal.set(false);
    // Anti-doublon : un même titre (insensible à la casse) ne peut pas être ajouté 2 fois.
    const title = value.title.trim().toLowerCase();
    if (this.setupsStore.active().some((s) => s.title.trim().toLowerCase() === title)) {
      this.setupMsg.set(`« ${value.title.trim()} » existe déjà.`);
      return;
    }
    this.setupMsg.set(null);
    this.setupsStore.create(
      value,
      undefined,
      (msg) => this.setupMsg.set(msg),
    );
  }
  protected removeSetup(id: string): void {
    // Garde-fou : au moins un setup doit rester, sinon le sélecteur de trade
    // de l'étape suivante est vide et le premier trade échoue (setupId requis).
    if (this.setupsStore.active().length <= 1) {
      this.setupMsg.set('Garde au moins un setup pour pouvoir logger tes trades.');
      return;
    }
    this.setupMsg.set(null);
    this.setupsStore.remove(id, (msg) => this.setupMsg.set(msg));
  }

  // Étape Stratégie (5) → enregistre le profil IA (SANS terminer l'onboarding)
  // puis va aux Actifs (6). Marquer l'onboarding fini ici sauterait les étapes
  // Actifs (6) et Premier trade (7) — le flag n'est posé qu'à l'écran final.
  private saveProfileThenGoAssets(): void {
    this.isSaving.set(true);
    this.usersApi
      .saveOnboardingProfile({
        market: this.selectedMarket(),
        goal: this.selectedGoal(),
        startingCapital: this.parseCapital(),
        currency: this.selectedCurrency(),
        tradingStyle: this.selectedStyle() ?? undefined,
        strategyDescription: this.strategyDescription().trim() || undefined,
        tradingSessions: this.selectedSessions(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => { this.auth.setCurrentUser(res.data); this.isSaving.set(false); this.step.set(6); },
        error: () => { this.isSaving.set(false); this.step.set(6); },
      });
  }

  // Étape Actifs (6) → persiste actifs + favori puis va au premier trade (7)
  private saveAssetsThenGoTrade(): void {
    this.isSaving.set(true);
    const assets = this.selectedAssets();
    const favorite = this.favoriteAsset();
    this.tradesApi
      .saveUserAssets(assets, favorite)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          // Rafraîchir le store (optimiste, exactement ce qui part en base) pour que
          // profileIncomplete() ne déclenche pas à tort « Complète ton profil » au dashboard.
          const u = this.auth.currentUser();
          if (u) this.auth.setCurrentUser({ ...u, tradingAssets: assets, favoriteAsset: favorite });
          this.isSaving.set(false);
          this.step.set(7);
        },
        error: () => { this.isSaving.set(false); this.step.set(7); },
      });
  }

  // Trade manuel sauvegardé → on crée le trade puis on va à l'étape Discord
  protected onTradeFormSave(dto: CreateTradeDto): void {
    this.isSaving.set(true);
    this.tradesApi
      .create(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => { this.tradesStore.addTrade(res.data); this.isSaving.set(false); this.step.set(9); },
        error: () => { this.isSaving.set(false); this.step.set(9); },
      });
  }

  // TradeForm fermé sans sauvegarder → retour au choix
  protected onTradeFormDismissed(): void { this.tradeChoice.set('choice'); }

  // CSV importé → étape Discord
  protected onCsvImported(): void { this.csvOpen.set(false); this.step.set(9); }
  protected onCsvDismissed(): void { this.csvOpen.set(false); this.tradeChoice.set('choice'); }

  protected get progress(): number {
    return Math.round((this.step() / 9) * 100);
  }

  protected get stepLabel(): string {
    const s = this.step();
    if (s === 1 || s === 9) return '';
    return `Étape ${s - 1} sur 7`;
  }

  private parseCapital(): number {
    const raw = this.capitalInput().replace(',', '.');
    const parsed = parseFloat(raw);
    return isNaN(parsed) || parsed < 0 ? 0 : parsed;
  }
}
