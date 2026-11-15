import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserStore } from '../stores/user.store';
import { rememberReturnUrl } from './return-url';

export const authGuard: CanActivateFn = (_route, state) => {
  const store = inject(UserStore);
  const router = inject(Router);

  if (store.isLoggedIn()) return true;
  // Page demandée retrouvée après la connexion (#994) : lien d'e-mail ou de push.
  if (state?.url) rememberReturnUrl(state.url);
  router.navigate(['/login']);
  return false;
};

export const premiumGuard: CanActivateFn = () => {
  const store = inject(UserStore);
  const router = inject(Router);

  if (store.isPremium()) return true;
  router.navigate(store.isLoggedIn() ? ['/profil'] : ['/login']);
  return false;
};

export const adminGuard: CanActivateFn = () => {
  const store = inject(UserStore);
  const router = inject(Router);

  if (store.isAdmin()) return true;
  router.navigate(['/dashboard']);
  return false;
};
