import { Injectable, computed, inject } from '@angular/core';
import { AuthService } from '../auth/auth.service';

@Injectable({ providedIn: 'root' })
export class UserStore {
  private readonly auth = inject(AuthService);

  readonly user = this.auth.currentUser;
  readonly isAuthenticated = this.auth.isAuthenticated;
  readonly isPremium = computed(() => this.user()?.plan === 'PREMIUM');
  readonly displayName = computed(() => this.user()?.name ?? this.user()?.email ?? '');
  readonly initials = computed(() => {
    const name = this.user()?.name ?? this.user()?.email ?? '?';
    return name.slice(0, 2).toUpperCase();
  });
}
