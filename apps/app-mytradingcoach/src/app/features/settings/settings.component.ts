import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  WritableSignal,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
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

  // Danger
  protected readonly showPlanModal = signal(false);
  protected readonly showDeleteConfirm = signal(false);
  protected readonly deleteInput = signal('');
  protected readonly isDeleting = signal(false);

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
    }
  }

  protected startTrial(plan: 'monthly' | 'yearly' = 'monthly') {
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
          this.strategySaved.set(true);
          setTimeout(() => this.strategySaved.set(false), 2500);
        },
        error: () => this.isSavingStrategy.set(false),
      });
  }

  protected confirmDelete() {
    if (this.deleteInput() !== 'SUPPRIMER') return;
    this.isDeleting.set(true);
    this.usersApi
      .deleteMe()
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
}
