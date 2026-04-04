import { Injectable, computed, inject } from '@angular/core';
import { AuthService } from '../auth/auth.service';

@Injectable({ providedIn: 'root' })
export class UserStore {
  private readonly auth = inject(AuthService);

  readonly user = this.auth.currentUser;
  readonly isAuthenticated = this.auth.isAuthenticated;
  readonly isPremium = computed(() => {
    const user = this.user();
    if (!user) return false;
    if (user.plan === 'PREMIUM') return true;
    if (user.trialEndsAt && new Date() < new Date(user.trialEndsAt)) return true;
    return false;
  });
  readonly displayName = computed(() => this.user()?.name ?? this.user()?.email ?? '');
  readonly initials = computed(() => {
    const name = this.user()?.name ?? this.user()?.email ?? '?';
    return name.slice(0, 2).toUpperCase();
  });
}
