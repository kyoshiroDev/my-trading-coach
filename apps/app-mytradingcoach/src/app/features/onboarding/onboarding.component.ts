import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { UsersApi } from '../../core/api/users.api';
import { TradesApi, CreateTradeDto } from '../../core/api/trades.api';
import { TradesStore } from '../../core/stores/trades.store';
import { AuthService } from '../../core/auth/auth.service';
import { LucideAngularModule, Bitcoin } from 'lucide-angular';
import { TradeFormComponent } from '../journal/trade-form.component';
import { CsvImportComponent } from '../journal/csv-import.component';

type Market = 'CRYPTO' | 'FOREX' | 'ACTIONS' | 'MULTI';
type Goal   = 'DISCIPLINE' | 'PERFORMANCE' | 'PSYCHOLOGIE';

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
  imports: [LucideAngularModule, TradeFormComponent, CsvImportComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.css',
})
export class OnboardingComponent {
  completed = output<void>();

  private readonly usersApi    = inject(UsersApi);
  private readonly tradesApi   = inject(TradesApi);
  private readonly tradesStore = inject(TradesStore);
  private readonly auth        = inject(AuthService);
  private readonly destroyRef  = inject(DestroyRef);

  protected readonly MARKETS    = MARKETS;
  protected readonly GOALS      = GOALS;
  protected readonly discordUrl = DISCORD_URL;

  protected readonly step         = signal<1|2|3|4|5|6>(1);
  protected readonly tradeChoice  = signal<'choice'|'manual'|'csv'>('choice');
  protected readonly csvOpen      = signal(false);
  protected readonly selectedMarket   = signal<Market | null>(null);
  protected readonly selectedGoal     = signal<Goal | null>(null);
  protected readonly selectedCurrency = signal<'USD' | 'EUR'>('USD');
  protected readonly capitalInput     = signal('');
  protected readonly isSaving         = signal(false);

  protected selectMarket(m: Market)          { this.selectedMarket.set(m); }
  protected selectGoal(g: Goal)              { this.selectedGoal.set(g); }
  protected selectCurrency(c: 'USD'|'EUR')   { this.selectedCurrency.set(c); }

  protected filterCapital(event: Event): void {
    const input = event.target as HTMLInputElement;
    input.value = input.value.replace(/[^\d.,]/g, '');
    this.capitalInput.set(input.value);
  }

  protected nextStep(): void {
    const s = this.step();
    if (s === 4) {
      this.saveProfileThenGoStep5();
    } else if (s < 6) {
      this.step.set((s + 1) as 1|2|3|4|5|6);
    }
  }

  protected prevStep(): void {
    const s = this.step();
    if (s === 5) { this.tradeChoice.set('choice'); this.step.set(4); }
    else if (s > 1 && s < 6) { this.step.set((s - 1) as 1|2|3|4|5|6); }
  }

  protected chooseManual() { this.tradeChoice.set('manual'); }
  protected chooseCsv()    { this.tradeChoice.set('csv'); this.csvOpen.set(true); }
  protected backToChoice() { this.tradeChoice.set('choice'); this.csvOpen.set(false); }

  protected finishAndGoDiscord() { this.step.set(6); }

  protected skip(): void {
    this.isSaving.set(true);
    this.usersApi
      .completeOnboarding({
        market: this.selectedMarket(),
        goal: this.selectedGoal(),
        startingCapital: this.parseCapital(),
        currency: this.selectedCurrency(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => { this.auth.setCurrentUser(res.data); this.isSaving.set(false); this.completed.emit(); },
        error: () => { this.isSaving.set(false); this.completed.emit(); },
      });
  }

  // Appelé quand l'utilisateur valide le capital (étape 4 → 5)
  private saveProfileThenGoStep5(): void {
    this.isSaving.set(true);
    this.usersApi
      .completeOnboarding({
        market: this.selectedMarket(),
        goal: this.selectedGoal(),
        startingCapital: this.parseCapital(),
        currency: this.selectedCurrency(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => { this.auth.setCurrentUser(res.data); this.isSaving.set(false); this.step.set(5); },
        error: () => { this.isSaving.set(false); this.step.set(5); },
      });
  }

  // Trade manuel sauvegardé → on crée le trade puis on va à l'étape Discord
  protected onTradeFormSave(dto: CreateTradeDto): void {
    this.isSaving.set(true);
    this.tradesApi
      .create(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => { this.tradesStore.addTrade(res.data); this.isSaving.set(false); this.step.set(6); },
        error: () => { this.isSaving.set(false); this.step.set(6); },
      });
  }

  // TradeForm fermé sans sauvegarder → retour au choix
  protected onTradeFormDismissed(): void { this.tradeChoice.set('choice'); }

  // CSV importé → étape Discord
  protected onCsvImported(): void { this.csvOpen.set(false); this.step.set(6); }
  protected onCsvDismissed(): void { this.csvOpen.set(false); this.tradeChoice.set('choice'); }

  protected get progress(): number {
    return Math.round((this.step() / 6) * 100);
  }

  protected get stepLabel(): string {
    const s = this.step();
    if (s === 1 || s === 6) return '';
    return `Étape ${s - 1} sur 4`;
  }

  private parseCapital(): number {
    const raw = this.capitalInput().replace(',', '.');
    const parsed = parseFloat(raw);
    return isNaN(parsed) || parsed < 0 ? 0 : parsed;
  }
}
