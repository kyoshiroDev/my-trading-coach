import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe, TitleCasePipe } from '@angular/common';
import {
  LucideDynamicIcon,
  LucideUsers as Users,
  LucideCircleCheck as CircleCheck,
  LucideTrendingUp as TrendingUp,
  LucideAward as Award,
  LucideCheck as Check,
} from '@lucide/angular';
import { AmbassadorApi, AmbassadorStats, ReferralUser } from '../../core/api/ambassador.api';
import { ReferralApi } from '../../core/api/referral.api';
import { AmbassadorNotifService } from '../../core/services/ambassador-notif.service';
import { ToastService } from '../../core/services/toast.service';
import { PRICING } from '../../core/constants/pricing.const';
import { environment } from '../../../environments/environment';
import { ErrorStateComponent } from '@mtc/front-ui';

// Commission mensuelle estimée par filleul payant (20% de la mensualité du plan).
const COMMISSION_RATE = 0.2;

@Component({
  selector: 'mtc-ambassador',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ErrorStateComponent, DatePipe, DecimalPipe, TitleCasePipe, LucideDynamicIcon],
  templateUrl: './ambassador.component.html',
  styleUrl: './ambassador.component.css',
})
export class AmbassadorComponent implements OnInit {
  private readonly api = inject(AmbassadorApi);
  private readonly referralApi = inject(ReferralApi);
  private readonly notif = inject(AmbassadorNotifService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  protected readonly UsersIcon = Users;
  protected readonly CircleCheckIcon = CircleCheck;
  protected readonly TrendingUpIcon = TrendingUp;
  protected readonly AwardIcon = Award;
  protected readonly CheckIcon = Check;

  protected readonly stats = signal<AmbassadorStats | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly loadError = signal(false);

  protected readonly statementLoading = signal(false);

  protected readonly referralLink = computed(() => {
    const code = this.stats()?.referralCode;
    if (!code) return '';
    // Pointe vers la landing (page de vente) avec le code de parrainage.
    return `${environment.landingUrl}/?ref=${code}`;
  });

  /** Filleuls payants (plan Premium). */
  protected readonly paidCount = computed(() => {
    const s = this.stats();
    return s ? s.premium : 0;
  });

  /** Commission du mois courant (données réelles ReferralCommission). */
  protected readonly currentMonthEarnings = computed(() => {
    const earnings = this.stats()?.earningsByMonth ?? {};
    const key = new Date().toISOString().slice(0, 7);
    return earnings[key] ?? 0;
  });

  protected readonly currentMonthLabel = computed(() =>
    new Date().toLocaleDateString('fr-FR', { month: 'long' }),
  );

  ngOnInit() {
    this.notif.markSeen();
    this.load();
  }

  protected load(): void {
    this.isLoading.set(true);
    this.loadError.set(false);
    this.api.getStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.stats.set(res.data);
          this.isLoading.set(false);
        },
        error: () => {
          this.loadError.set(true);
          this.isLoading.set(false);
        },
      });
  }

  protected copyLink(): void {
    // Feedback transitoire → toast (PROMPT-210). L'échec du presse-papiers était muet.
    navigator.clipboard.writeText(this.referralLink()).then(
      () => this.toast.success('Lien copié'),
      () => this.toast.error('Copie impossible : sélectionne le lien et copie-le à la main.'),
    );
  }

  /** Génère le relevé de commissions (PDF) : telechargement + email à l'équipe. */
  protected generateStatement(): void {
    if (this.statementLoading()) return;
    this.statementLoading.set(true);
    this.referralApi.generateStatement()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `releve-commissions-${new Date().toISOString().slice(0, 7)}.pdf`;
          a.click();
          URL.revokeObjectURL(url);
          this.statementLoading.set(false);
          this.toast.success('Relevé généré');
        },
        error: () => {
          this.statementLoading.set(false);
          this.toast.error('Génération du relevé impossible pour le moment. Réessaie.');
        },
      });
  }

  protected isPaid(u: ReferralUser): boolean {
    return u.plan === 'PREMIUM';
  }

  /** Commission mensuelle estimée du filleul (20% de la mensualité Premium). */
  protected monthlyCommission(u: ReferralUser): number {
    if (u.plan === 'PREMIUM') return +(PRICING.premium.monthly * COMMISSION_RATE).toFixed(2);
    return 0;
  }

  protected avatar(u: ReferralUser): string {
    const base = u.name ?? u.email;
    return base.slice(0, 2).toUpperCase();
  }
}
