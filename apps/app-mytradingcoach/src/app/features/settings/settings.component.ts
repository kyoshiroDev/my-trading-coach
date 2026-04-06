import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { UserStore } from '../../core/stores/user.store';
import { BillingApi } from '../../core/api/billing.api';

@Component({
  selector: 'mtc-settings',
  standalone: true,
  imports: [TopbarComponent, DatePipe],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent implements OnInit {
  protected readonly userStore = inject(UserStore);
  private readonly billingApi = inject(BillingApi);
  private readonly route = inject(ActivatedRoute);

  protected readonly checkoutParam = toSignal(
    this.route.queryParamMap.pipe(map((p) => p.get('checkout'))),
  );

  ngOnInit(): void {
    if (this.route.snapshot.queryParamMap.get('checkout') === 'success') {
      this.userStore.refreshUser();
    }
  }

  protected startTrial(plan: 'monthly' | 'yearly' = 'monthly') {
    this.billingApi.checkout(plan).subscribe({
      next: (res) => {
        window.location.href = res.data.url;
      },
      error: () => console.error('Erreur lors de la création de la session checkout'),
    });
  }

  protected openPortal() {
    this.billingApi.portal().subscribe({
      next: (res) => {
        window.location.href = res.data.url;
      },
      error: () => console.error('Erreur lors de la création de la session portal'),
    });
  }
}
