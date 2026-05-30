import { Injectable, DestroyRef, inject, signal, effect } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AmbassadorApi } from '../api/ambassador.api';
import { UserStore } from '../stores/user.store';

@Injectable({ providedIn: 'root' })
export class AmbassadorNotifService {
  private readonly api = inject(AmbassadorApi);
  private readonly userStore = inject(UserStore);
  private readonly destroyRef = inject(DestroyRef);

  private readonly LAST_SEEN_KEY = 'ambassador_last_seen';

  readonly newReferrals = signal(0);

  constructor() {
    effect(() => {
      if (!this.userStore.isAmbassador()) return;

      const lastSeen = localStorage.getItem(this.LAST_SEEN_KEY) ?? new Date(0).toISOString();
      this.api.getNewCount(lastSeen)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => this.newReferrals.set(res.data.count),
        });
    });
  }

  markSeen(): void {
    localStorage.setItem(this.LAST_SEEN_KEY, new Date().toISOString());
    this.newReferrals.set(0);
  }
}
