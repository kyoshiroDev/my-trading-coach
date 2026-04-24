import {
  ChangeDetectionStrategy, Component, DestroyRef, inject, output, signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap, tap } from 'rxjs/operators';
import { UsersApi, CompleteOnboardingDto } from '../../core/api/users.api';
import { TradesApi, CreateTradeDto } from '../../core/api/trades.api';
import { TradesStore } from '../../core/stores/trades.store';
import { AuthService } from '../../core/auth/auth.service';
import { LucideAngularModule, Bitcoin } from 'lucide-angular';
import { TradeFormComponent } from '../journal/trade-form.component';

type Market = 'CRYPTO' | 'FOREX' | 'ACTIONS' | 'MULTI';
type Goal = 'DISCIPLINE' | 'PERFORMANCE' | 'PSYCHOLOGIE';

type MarketOption = { value: Market; label: string; emoji?: string; icon?: typeof Bitcoin; iconColor?: string; desc: string };

const MARKETS: MarketOption[] = [
  { value: 'CRYPTO', label: 'Crypto', icon: Bitcoin, iconColor: '#F7931A', desc: 'Bitcoin, Ethereum, altcoins' },
  { value: 'FOREX', label: 'Forex', emoji: '💱', desc: 'EUR/USD, paires de devises' },
  { value: 'ACTIONS', label: 'Actions', emoji: '📈', desc: 'Actions, ETF, indices' },
  { value: 'MULTI', label: 'Multi-marchés', emoji: '🌐', desc: 'Je trade plusieurs marchés' },
];

const GOALS: { value: Goal; label: string; emoji: string; desc: string }[] = [
  { value: 'DISCIPLINE', label: 'Discipline', emoji: '🎯', desc: 'Respecter mon plan de trading et mes règles' },
  { value: 'PERFORMANCE', label: 'Performance', emoji: '🚀', desc: 'Améliorer mon win rate et ma rentabilité' },
  { value: 'PSYCHOLOGIE', label: 'Psychologie', emoji: '🧠', desc: 'Gérer mes émotions et éviter les revenge trades' },
];

@Component({
  selector: 'mtc-onboarding',
  standalone: true,
  imports: [LucideAngularModule, TradeFormComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.css',
})
export class OnboardingComponent {
  completed = output<void>();

  private readonly usersApi = inject(UsersApi);
  private readonly tradesApi = inject(TradesApi);
  private readonly tradesStore = inject(TradesStore);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly MARKETS = MARKETS;
  protected readonly GOALS = GOALS;

  protected readonly step = signal<1 | 2 | 3>(1);
  protected readonly selectedMarket = signal<Market | null>(null);
  protected readonly selectedGoal = signal<Goal | null>(null);
  protected readonly isSaving = signal(false);

  protected selectMarket(m: Market) { this.selectedMarket.set(m); }
  protected selectGoal(g: Goal) { this.selectedGoal.set(g); }

  protected nextStep() {
    const s = this.step();
    if (s === 1) this.step.set(2);
    else if (s === 2) this.step.set(3);
  }

  protected skip() {
    this.finishOnboarding(null, null);
  }

  protected onTradeFormSave(dto: CreateTradeDto) {
    this.isSaving.set(true);
    const onboardingDto: CompleteOnboardingDto = {
      market: this.selectedMarket(),
      goal: this.selectedGoal(),
    };
    this.usersApi.completeOnboarding(onboardingDto).pipe(
      tap((res) => {
        this.auth.currentUser.set(res.data);
        localStorage.setItem('user', JSON.stringify(res.data));
      }),
      switchMap(() => this.tradesApi.create(dto)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.tradesStore.loadTrades();
        this.isSaving.set(false);
        this.completed.emit();
      },
      error: () => {
        this.isSaving.set(false);
        this.completed.emit();
      },
    });
  }

  protected onTradeFormDismissed() {
    this.finishOnboarding(this.selectedMarket(), this.selectedGoal());
  }

  private finishOnboarding(market: Market | null, goal: Goal | null) {
    this.isSaving.set(true);
    this.usersApi.completeOnboarding({ market, goal }).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (res) => {
        this.auth.currentUser.set(res.data);
        localStorage.setItem('user', JSON.stringify(res.data));
        this.isSaving.set(false);
        this.completed.emit();
      },
      error: () => {
        this.isSaving.set(false);
        this.completed.emit();
      },
    });
  }

  protected get progress(): number {
    return this.step() === 1 ? 33 : this.step() === 2 ? 66 : 100;
  }
}
