import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { EMPTY, fromEvent } from 'rxjs';
import { catchError, filter, switchMap, tap } from 'rxjs/operators';
import { environment } from '@app/environments/environment';
import { POLLING_MS } from '../constants/polling.const';
import { visibleInterval } from '../utils/visible-interval';
import { SelectedAccountStore } from '../stores/selected-account.store';
import { TradesStore } from '../stores/trades.store';
import { SetupsStore } from '../stores/setups.store';
import type { Plan, Role } from '@mtc/shared';

/** Rôle d'un utilisateur : alias du contrat partagé, gardé pour les importeurs existants. */
export type UserRole = Role;

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  plan: Plan;
  role?: UserRole;
  trialEndsAt?: string | null;
  /** Essai Stripe déjà consommé (ou Premium offert reçu) : plus d'essai de 30 j au checkout. */
  trialUsed?: boolean;
  /** Statut de l'abonnement Stripe (`active`, `trialing`, `canceled`…), jamais d'identifiant. */
  stripeSubscriptionStatus?: string | null;
  stripeCurrentPeriodEnd?: string | null;
  isDemo?: boolean;
  onboardingCompleted?: boolean;
  market?: string | null;
  goal?: string | null;
  startingCapital?: number;
  notificationsEmail?: boolean;
  debriefAutomatic?: boolean;
  marketingConsent?: boolean;
  tradingStyle?: string | null;
  tradingStrategy?: string[];
  tradingSessions?: string[];
  tradesPerDayMin?: number | null;
  tradesPerDayMax?: number | null;
  strategyDescription?: string | null;
  tradingAssets?: string[];
  favoriteAsset?: string | null;
  discordId?: string | null;
}

/** UTM du lien d'inscription (landing → /register), transmis tels quels à l'API. */
export interface Acquisition {
  acquisitionSource?: string;
  acquisitionMedium?: string;
  acquisitionCampaign?: string;
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
  // Stores user-scoped à purger au logout (anti-fuite inter-comptes). Ces stores n'injectent
  // jamais AuthService → pas de cycle DI.
  private readonly accountStore = inject(SelectedAccountStore);
  private readonly tradesStore = inject(TradesStore);
  private readonly setupsStore = inject(SetupsStore);

  readonly currentUser = signal<AuthUser | null>(null);
  readonly isAuthenticated = signal(false);

  constructor() {
    this.loadFromStorage();
    this.startUserSync();
  }

  private startUserSync(): void {
    // SCA-B4-01 / B4-02 : toutes les 5 min (était 30 s, pour TOUS les connectés, onglet caché
    // compris), muet onglet caché ; au retour sur l'onglet, rafraîchi seulement si la dernière
    // synchro date de plus d'une minute (un trader alterne sans cesse entre ses onglets).
    let lastSync = Date.now();
    const refresh$ = this.fetchMe().pipe(
      tap(() => (lastSync = Date.now())),
      catchError(() => EMPTY),
    );

    visibleInterval(POLLING_MS.USER_SYNC)
      .pipe(
        filter(() => this.isAuthenticated()),
        switchMap(() => refresh$),
      )
      .subscribe();

    fromEvent(document, 'visibilitychange')
      .pipe(
        filter(() => !document.hidden && this.isAuthenticated() && Date.now() - lastSync > 60_000),
        switchMap(() => refresh$),
      )
      .subscribe();
  }

  register(
    email: string,
    password: string,
    name?: string,
    referralCode?: string,
    marketingConsent?: boolean,
    acquisition?: Acquisition,
  ) {
    return this.http
      .post<AuthResponse>(
        `${environment.apiUrl}/auth/register`,
        { email, password, name, referralCode, marketingConsent, ...acquisition },
        { withCredentials: true },
      )
      .pipe(tap((res) => this.handleAuthResponse(res)));
  }

  login(email: string, password: string) {
    return this.http
      .post<AuthResponse>(
        `${environment.apiUrl}/auth/login`,
        { email, password },
        { withCredentials: true },
      )
      .pipe(tap((res) => this.handleAuthResponse(res)));
  }

  logout() {
    this.http
      .post(`${environment.apiUrl}/auth/logout`, {}, { withCredentials: true })
      .subscribe();
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    this.currentUser.set(null);
    this.isAuthenticated.set(false);
    // Purge les stores user-scoped : sans ça, un login sur un AUTRE compte dans le même onglet
    // (navigation SPA sans reload) héritait des comptes/setups/trades du user précédent.
    this.accountStore.reset();
    this.tradesStore.reset();
    this.setupsStore.reset();
    this.router.navigate(['/login']);
  }

  getAccessToken(): string | null {
    return localStorage.getItem('access_token');
  }

  /** Met à jour le signal user ET le localStorage en une seule opération. */
  setCurrentUser(user: AuthUser): void {
    this.currentUser.set(user);
    localStorage.setItem('user', JSON.stringify(user));
  }

  refreshToken() {
    // Le refresh_token est envoyé automatiquement via le cookie httpOnly
    return this.http
      .post<AuthResponse>(
        `${environment.apiUrl}/auth/refresh`,
        {},
        { withCredentials: true },
      )
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

  /** Connexion au compte démo vitrine (lecture seule). Stocke token + user. */
  demoLogin() {
    return this.http
      .post<AuthResponse>(`${environment.apiUrl}/auth/demo-login`, {})
      .pipe(tap((res) => this.handleAuthResponse(res)));
  }

  forgotPassword(email: string) {
    return this.http.post(`${environment.apiUrl}/auth/forgot-password`, {
      email,
    });
  }

  resetPassword(token: string, password: string) {
    return this.http.post(`${environment.apiUrl}/auth/reset-password`, {
      token,
      password,
    });
  }

  fetchMe() {
    return this.http
      .get<{ data: AuthUser }>(`${environment.apiUrl}/auth/me`)
      .pipe(
        tap((res) => {
          const incoming = res.data;
          // Si le client a déjà onboardingCompleted=true (ex: completeOnboarding en vol),
          // ne pas l'écraser avec false venant de la DB (race condition réseau)
          if (
            this.currentUser()?.onboardingCompleted === true &&
            !incoming.onboardingCompleted
          ) {
            incoming.onboardingCompleted = true;
          }
          localStorage.setItem('user', JSON.stringify(incoming));
          this.currentUser.set(incoming);
        }),
      );
  }

  /** @deprecated : utiliser fetchMe() directement */
  refreshUser() {
    return this.fetchMe();
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
