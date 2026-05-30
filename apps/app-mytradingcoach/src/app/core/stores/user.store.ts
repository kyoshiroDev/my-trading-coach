import { Injectable, computed, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';

@Injectable({ providedIn: 'root' })
export class UserStore {
  private readonly auth = inject(AuthService);

  readonly user = this.auth.currentUser;
  readonly isAuthenticated = this.auth.isAuthenticated;
  readonly isLoggedIn = computed(() => !!this.user());
  readonly isStarter = computed(() => {
    const user = this.user();
    if (!user) return false;
    if (user.role === 'ADMIN' || user.role === 'BETA_TESTER') return true;
    if (user.trialEndsAt && new Date() < new Date(user.trialEndsAt)) return true;
    return user.plan === 'STARTER' || user.plan === 'PREMIUM';
  });

  readonly isPremium = computed(() => {
    const user = this.user();
    if (!user) return false;
    if (user.role === 'ADMIN' || user.role === 'BETA_TESTER') return true;
    if (user.plan === 'PREMIUM') return true;
    return !!(user.trialEndsAt && new Date() < new Date(user.trialEndsAt));
  });

  readonly isAdmin = computed(() => this.user()?.role === 'ADMIN');
  readonly isBeta = computed(
    () => this.user()?.role === 'BETA_TESTER' || this.user()?.role === 'ADMIN',
  );
  readonly isAmbassador = computed(
    () => this.user()?.role === 'AMBASSADOR' || this.user()?.role === 'ADMIN',
  );
  readonly startingCapital = computed(() => this.user()?.startingCapital ?? 0);
  readonly tradingAssets = computed(() => this.user()?.tradingAssets ?? []);
  readonly favoriteAsset = computed(() => this.user()?.favoriteAsset ?? null);
  readonly displayName = computed(
    () => this.user()?.name ?? this.user()?.email ?? '',
  );
  readonly initials = computed(() => {
    const name = this.user()?.name ?? this.user()?.email ?? '?';
    return name.slice(0, 2).toUpperCase();
  });

  refreshUser() {
    firstValueFrom(this.auth.fetchMe()).catch(() => { /* silently ignore */ });
  }
}
