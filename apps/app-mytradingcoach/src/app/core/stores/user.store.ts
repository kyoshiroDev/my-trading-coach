import { Injectable, computed, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { ACCOUNT_LIMITS } from '../constants/pricing.const';

const DAY_MS = 86_400_000;

@Injectable({ providedIn: 'root' })
export class UserStore {
  private readonly auth = inject(AuthService);

  readonly user = this.auth.currentUser;
  readonly isAuthenticated = this.auth.isAuthenticated;
  readonly isLoggedIn = computed(() => !!this.user());

  /** Accès payant : plan PREMIUM, essai en cours, ou rôle privilégié (admin / beta). */
  readonly isPremium = computed(() => {
    const user = this.user();
    if (!user) return false;
    if (user.role === 'ADMIN' || user.role === 'BETA_TESTER') return true;
    if (user.plan === 'PREMIUM') return true;
    return !!(user.trialEndsAt && new Date() < new Date(user.trialEndsAt));
  });

  /**
   * Premium sans abonnement : `trialEndsAt` futur SANS abonnement Stripe en cours (essai
   * d'inscription ou Premium offert par l'admin). Aucun prélèvement, retour en gratuit automatique.
   */
  private readonly freePremium = computed(() => {
    const user = this.user();
    if (!user?.trialEndsAt || user.isDemo || new Date() >= new Date(user.trialEndsAt)) return false;
    const status = user.stripeSubscriptionStatus;
    return status !== 'active' && status !== 'trialing';
  });

  /** Premium offert par l'admin (hors essai d'inscription, #769). Mêmes règles côté API. */
  readonly isOfferedPremium = computed(() => this.freePremium() && this.user()?.trialSource !== 'SIGNUP');

  /**
   * Essai d'inscription en cours (#769) : jours restants (arrondis au jour supérieur, 1 le dernier
   * jour), sinon `null`. Démo, abonné Stripe et Premium offert par l'admin : `null`.
   */
  readonly signupTrialDaysLeft = computed<number | null>(() => {
    const user = this.user();
    if (!this.freePremium() || user?.trialSource !== 'SIGNUP' || !user.trialEndsAt) return null;
    return Math.max(1, Math.ceil((new Date(user.trialEndsAt).getTime() - Date.now()) / DAY_MS));
  });

  /**
   * Essai d'inscription terminé et pas d'autre accès Premium (#769) : fenêtre de fin d'essai.
   * Un Premium offert ensuite passe l'origine à ADMIN : la fenêtre attend sa propre fin.
   */
  readonly signupTrialEnded = computed(() => {
    const user = this.user();
    if (!user?.signupTrialEndsAt || user.isDemo || user.trialSource !== 'SIGNUP') return false;
    return new Date() >= new Date(user.signupTrialEndsAt) && !this.isPremium();
  });

  /** L'essai Stripe de 30 j est encore disponible au checkout (miroir de `trialUsed` côté API). */
  readonly trialAvailable = computed(() => !this.user()?.trialUsed);

  /**
   * Quota de comptes de trading du plan courant : `null` = illimité.
   * Premium / trial / admin → illimité · Free → 1. Aligné backend.
   */
  readonly maxAccounts = computed<number | null>(() => {
    if (this.isPremium()) return ACCOUNT_LIMITS.premium; // null (illimité)
    return ACCOUNT_LIMITS.free;
  });

  /** Compte démo vitrine (lecture seule) : bandeau + actions redirigées vers l'inscription. */
  readonly isDemo = computed(() => this.user()?.isDemo === true);

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

  /**
   * Profil IA incomplet : pas de stratégie OU pas d'actif (comptes créés avant l'onboarding enrichi).
   * La stratégie est renseignée dès qu'on a un STYLE, une DESCRIPTION ou le tableau de stratégies :
   * l'onboarding enregistre `tradingStyle` + `strategyDescription` (jamais `tradingStrategy`), donc
   * exiger le seul tableau affichait la bannière à tout nouvel utilisateur pourtant onboardé.
   */
  readonly profileIncomplete = computed(() => {
    const u = this.user();
    if (!u) return false;
    const noStrategy = !u.tradingStyle && !u.strategyDescription && !(u.tradingStrategy?.length);
    const noAsset = !u.favoriteAsset && !(u.tradingAssets?.length);
    return noStrategy || noAsset;
  });
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
