import { Injectable, computed, inject } from '@angular/core';
import { AuthService } from '../auth/auth.service';

@Injectable({ providedIn: 'root' })
export class UserStore {
  private readonly auth = inject(AuthService);

  readonly user = this.auth.currentUser;
  readonly isAuthenticated = this.auth.isAuthenticated;
  readonly isLoggedIn = computed(() => !!this.user());
  readonly isPremium = computed(() => {
    const user = this.user();
    if (!user) return false;
    if (user.role === 'ADMIN' || user.role === 'BETA_TESTER') return true;
    if (user.plan === 'PREMIUM') return true;
    return !!(user.trialEndsAt && new Date() < new Date(user.trialEndsAt));
  });

  readonly isAdmin = computed(() => this.user()?.role === 'ADMIN');
  readonly startingCapital = computed(() => this.user()?.startingCapital ?? 0);
  readonly displayName = computed(() => this.user()?.name ?? this.user()?.email ?? '');
  readonly initials = computed(() => {
    const name = this.user()?.name ?? this.user()?.email ?? '?';
    return name.slice(0, 2).toUpperCase();
  });

  refreshUser() {
    this.auth.refreshUser().subscribe({
      error: () => { /* silently ignore — user stays logged in with cached data */ },
    });
  }
}
