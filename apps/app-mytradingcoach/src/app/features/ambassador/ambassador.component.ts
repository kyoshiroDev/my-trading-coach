import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { AmbassadorApi, AmbassadorStats } from '../../core/api/ambassador.api';

@Component({
  selector: 'mtc-ambassador',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe],
  templateUrl: './ambassador.component.html',
  styleUrl: './ambassador.component.css',
})
export class AmbassadorComponent implements OnInit {
  private readonly api = inject(AmbassadorApi);

  protected readonly stats = signal<AmbassadorStats | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly copied = signal(false);

  protected readonly monthsSorted = computed(() => {
    const earnings = this.stats()?.earningsByMonth ?? {};
    return Object.entries(earnings)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, amount]) => ({ month, amount }));
  });

  protected readonly referralLink = computed(() => {
    const code = this.stats()?.referralCode;
    if (!code) return '';
    return `https://mytradingcoach.app?ref=${code}`;
  });

  ngOnInit() {
    this.api.getStats().subscribe({
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

  protected formatMonth(month: string): string {
    const [year, m] = month.split('-');
    return new Date(+year, +m - 1, 1).toLocaleDateString('fr-FR', {
      month: 'long', year: 'numeric',
    });
  }
}
