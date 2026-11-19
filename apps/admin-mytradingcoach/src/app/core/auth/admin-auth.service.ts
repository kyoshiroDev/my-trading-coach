import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { EMPTY, catchError, of, switchMap, throwError } from 'rxjs';
import { environment } from '@admin/environments/environment';
import type { Plan, Role } from '@mtc/shared';

export interface AdminAuthUser {
  id: string; email: string; name?: string;
  plan: Plan; role: Role;
}

/** Compte valide mais sans le rôle ADMIN (A18 #1065). */
export const NOT_ADMIN_MESSAGE = 'Ce compte n’a pas accès à l’admin.';

@Injectable({ providedIn: 'root' })
export class AdminAuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly currentUser = signal<AdminAuthUser | null>(null);
  readonly isAuthenticated = signal(false);
  readonly isAdmin = signal(false);

  /**
   * Incrémenté à chaque déconnexion (#1103) : le refresh partagé de `@mtc/front-auth` va au bout même
   * sans requête en attente ; une réponse arrivée après la déconnexion est ignorée.
   */
  private session = 0;

  constructor() { this.loadFromStorage(); }

  /**
   * Connexion à l'admin. Un compte non ADMIN (A18 #1065) n'est jamais gardé : aucun jeton stocké, la
   * session ouverte côté serveur (cookie de rafraîchissement) est fermée, et l'appel échoue avec
   * `NOT_ADMIN_MESSAGE` (avant : bouton bloqué sur « Connexion… », jeton gardé).
   */
  login(email: string, password: string) {
    return this.http.post<{ data: { access_token: string; user: AdminAuthUser } }>(
      `${environment.apiUrl}/auth/login`,
      { email, password },
      { withCredentials: true },
    ).pipe(
      switchMap((res) => {
        if (res.data.user?.role === 'ADMIN') {
          this.handleAuth(res.data);
          return of(res);
        }
        return this.http.post(`${environment.apiUrl}/auth/logout`, {}, {
          withCredentials: true,
          headers: { Authorization: `Bearer ${res.data.access_token}` },
        }).pipe(
          catchError(() => of(null)),
          switchMap(() => throwError(() => ({ status: 403, error: { message: NOT_ADMIN_MESSAGE } }))),
        );
      }),
    );
  }

  logout() {
    this.session++;
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

  /**
   * Renouvelle le jeton. Même règle que le login (#1103) : un compte qui n'est plus ADMIN (ou une
   * réponse sans utilisateur) ne laisse rien dans le navigateur et le refresh échoue avec
   * `NOT_ADMIN_MESSAGE` ; l'intercepteur `jwt-refresh` déconnecte alors (session serveur fermée).
   */
  refreshToken() {
    const session = this.session;
    return this.http.post<{ data: { access_token: string; user?: AdminAuthUser } }>(
      `${environment.apiUrl}/auth/refresh`,
      {},
      { withCredentials: true },
    ).pipe(
      switchMap((res) => {
        if (session !== this.session) return EMPTY; // déconnecté pendant le refresh
        const user = res.data.user;
        if (user?.role !== 'ADMIN') {
          return throwError(() => ({ status: 403, error: { message: NOT_ADMIN_MESSAGE } }));
        }
        this.handleAuth({ access_token: res.data.access_token, user });
        return of(res);
      }),
    );
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
