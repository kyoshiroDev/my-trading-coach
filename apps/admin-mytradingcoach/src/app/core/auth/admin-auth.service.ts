import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export interface AdminAuthUser {
  id: string; email: string; name?: string;
  plan: 'FREE' | 'PREMIUM'; role: 'ADMIN' | 'USER' | 'BETA_TESTER';
}

@Injectable({ providedIn: 'root' })
export class AdminAuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly currentUser = signal<AdminAuthUser | null>(null);
  readonly isAuthenticated = signal(false);
  readonly isAdmin = signal(false);

  constructor() { this.loadFromStorage(); }

  login(email: string, password: string) {
    return this.http.post<{ data: { access_token: string; user: AdminAuthUser } }>(
      `${environment.apiUrl}/auth/login`,
      { email, password },
      { withCredentials: true },
    ).pipe(tap(res => this.handleAuth(res.data)));
  }

  logout() {
    this.http.post(`${environment.apiUrl}/auth/logout`, {}, { withCredentials: true }).subscribe();
    localStorage.removeItem('admin_access_token');
    localStorage.removeItem('admin_user');
    this.currentUser.set(null);
    this.isAuthenticated.set(false);
    this.isAdmin.set(false);
    this.router.navigate(['/login']);
  }

  getAccessToken(): string | null {
    return localStorage.getItem('admin_access_token');
  }

  refreshToken() {
    return this.http.post<{ data: { access_token: string; user: AdminAuthUser } }>(
      `${environment.apiUrl}/auth/refresh`,
      {},
      { withCredentials: true },
    ).pipe(tap(res => {
      localStorage.setItem('admin_access_token', res.data.access_token);
      if (res.data.user) {
        localStorage.setItem('admin_user', JSON.stringify(res.data.user));
        this.currentUser.set(res.data.user);
      }
    }));
  }

  private handleAuth(data: { access_token: string; user: AdminAuthUser }) {
    localStorage.setItem('admin_access_token', data.access_token);
    localStorage.setItem('admin_user', JSON.stringify(data.user));
    this.currentUser.set(data.user);
    this.isAuthenticated.set(true);
    this.isAdmin.set(data.user.role === 'ADMIN');
  }

  private loadFromStorage() {
    const token = localStorage.getItem('admin_access_token');
    const userStr = localStorage.getItem('admin_user');
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr) as AdminAuthUser;
        this.currentUser.set(user);
        this.isAuthenticated.set(true);
        this.isAdmin.set(user.role === 'ADMIN');
      } catch { this.logout(); }
    }
  }
}
