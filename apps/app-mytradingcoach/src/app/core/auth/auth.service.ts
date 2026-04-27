import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { EMPTY, fromEvent, interval } from 'rxjs';
import { catchError, filter, switchMap, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export type UserRole = 'ADMIN' | 'USER' | 'BETA_TESTER';

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  plan: 'FREE' | 'PREMIUM';
  role?: UserRole;
  trialEndsAt?: string | null;
  stripeCurrentPeriodEnd?: string | null;
  onboardingCompleted?: boolean;
  market?: string | null;
  goal?: string | null;
  currency?: string;
  notificationsEmail?: boolean;
  debriefAutomatic?: boolean;
}

interface AuthResponse {
  data: {
    access_token: string;
    user: AuthUser;
  };
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly currentUser = signal<AuthUser | null>(null);
  readonly isAuthenticated = signal(false);

  constructor() {
    this.loadFromStorage();
    this.startUserSync();
  }

  private startUserSync(): void {
    const refresh$ = this.fetchMe().pipe(catchError(() => EMPTY));

    // Toutes les 30s quand connecté
    interval(30_000).pipe(
      filter(() => this.isAuthenticated()),
      switchMap(() => refresh$),
    ).subscribe();

    // Immédiatement quand l'onglet redevient visible
    fromEvent(document, 'visibilitychange').pipe(
      filter(() => !document.hidden && this.isAuthenticated()),
      switchMap(() => refresh$),
    ).subscribe();
  }

  register(email: string, password: string, name?: string) {
    return this.http
      .post<AuthResponse>(`${environment.apiUrl}/auth/register`, { email, password, name }, { withCredentials: true })
      .pipe(tap((res) => this.handleAuthResponse(res)));
  }

  login(email: string, password: string) {
    return this.http
      .post<AuthResponse>(`${environment.apiUrl}/auth/login`, { email, password }, { withCredentials: true })
      .pipe(tap((res) => this.handleAuthResponse(res)));
  }

  logout() {
    this.http.post(`${environment.apiUrl}/auth/logout`, {}, { withCredentials: true }).subscribe();
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    this.currentUser.set(null);
    this.isAuthenticated.set(false);
    this.router.navigate(['/login']);
  }

  getAccessToken(): string | null {
    return localStorage.getItem('access_token');
  }

  refreshToken() {
    // Le refresh_token est envoyé automatiquement via le cookie httpOnly
    return this.http
      .post<AuthResponse>(`${environment.apiUrl}/auth/refresh`, {}, { withCredentials: true })
      .pipe(
        tap((res) => {
          localStorage.setItem('access_token', res.data.access_token);
          if (res.data.user) {
            localStorage.setItem('user', JSON.stringify(res.data.user));
            this.currentUser.set(res.data.user);
          }
        }),
      );
  }

  forgotPassword(email: string) {
    return this.http.post(`${environment.apiUrl}/auth/forgot-password`, { email });
  }

  resetPassword(token: string, password: string) {
    return this.http.post(`${environment.apiUrl}/auth/reset-password`, { token, password });
  }

  isPremium(): boolean {
    const user = this.currentUser();
    if (!user) return false;
    if (user.role === 'ADMIN' || user.role === 'BETA_TESTER') return true;
    if (user.plan === 'PREMIUM') return true;
    return !!(user.trialEndsAt && new Date() < new Date(user.trialEndsAt));
  }

  isAdmin(): boolean {
    return this.currentUser()?.role === 'ADMIN';
  }

  fetchMe() {
    return this.http
      .get<{ data: AuthUser }>(`${environment.apiUrl}/auth/me`)
      .pipe(
        tap((res) => {
          const user = res.data;
          localStorage.setItem('user', JSON.stringify(user));
          this.currentUser.set(user);
        }),
      );
  }

  refreshUser() {
    return this.refreshToken();
  }

  private handleAuthResponse(res: AuthResponse) {
    const { access_token, user } = res.data;
    localStorage.setItem('access_token', access_token);
    localStorage.setItem('user', JSON.stringify(user));
    this.currentUser.set(user);
    this.isAuthenticated.set(true);
  }

  private loadFromStorage() {
    const token = localStorage.getItem('access_token');
    const userStr = localStorage.getItem('user');
    if (token && userStr) {
      try {
        this.currentUser.set(JSON.parse(userStr));
        this.isAuthenticated.set(true);
      } catch {
        this.logout();
      }
    }
  }
}