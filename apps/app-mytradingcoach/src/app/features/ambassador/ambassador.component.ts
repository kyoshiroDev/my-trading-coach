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
import { AmbassadorApi, AmbassadorStats, ReferralUser } from '../../core/api/ambassador.api';
import { ReferralApi } from '../../core/api/referral.api';
import { AmbassadorNotifService } from '../../core/services/ambassador-notif.service';
import { PRICING } from '../../core/constants/pricing.const';
import { environment } from '../../../environments/environment';

// Commission mensuelle estimée par filleul payant (20% de la mensualité du plan).
const COMMISSION_RATE = 0.2;

@Component({
  selector: 'mtc-ambassador',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, TitleCasePipe],
  templateUrl: './ambassador.component.html',
  styleUrl: './ambassador.component.css',
})
export class AmbassadorComponent implements OnInit {
  private readonly api = inject(AmbassadorApi);
  private readonly referralApi = inject(ReferralApi);
  private readonly notif = inject(AmbassadorNotifService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly stats = signal<AmbassadorStats | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly copied = signal(false);

  protected readonly statementLoading = signal(false);
  protected readonly statementError = signal(false);

  protected readonly referralLink = computed(() => {
    const code = this.stats()?.referralCode;
    if (!code) return '';
    // Pointe vers la landing (page de vente) avec le code de parrainage.
    return `${environment.landingUrl}/?ref=${code}`;
  });

  /** Filleuls payants (plan Starter/Premium). */
  protected readonly paidCount = computed(() => {
    const s = this.stats();
    return s ? s.starter + s.premium : 0;
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

    this.api.getStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.stats.set(res.data);
          this.isLoading.set(false);
        },
        error: () => this.isLoading.set(false),
      });
  }

  protected copyLink(): void {
    navigator.clipboard.writeText(this.referralLink()).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }

  /** Génère le relevé de commissions (PDF) : telechargement + email à l'équipe. */
  protected generateStatement(): void {
    if (this.statementLoading()) return;
    this.statementLoading.set(true);
    this.statementError.set(false);
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
        },
        error: () => { this.statementLoading.set(false); this.statementError.set(true); },
      });
  }

  protected isPaid(u: ReferralUser): boolean {
    return u.plan === 'STARTER' || u.plan === 'PREMIUM';
  }

  /** Commission mensuelle estimée du filleul (20% de la mensualité du plan). */
  protected monthlyCommission(u: ReferralUser): number {
    if (u.plan === 'PREMIUM') return +(PRICING.premium.monthly * COMMISSION_RATE).toFixed(2);
    if (u.plan === 'STARTER') return +(PRICING.starter.monthly * COMMISSION_RATE).toFixed(2);
    return 0;
  }

  protected avatar(u: ReferralUser): string {
    const base = u.name ?? u.email;
    return base.slice(0, 2).toUpperCase();
  }
}
