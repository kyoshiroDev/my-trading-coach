import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserStore } from '../stores/user.store';

export const authGuard: CanActivateFn = () => {
  const store  = inject(UserStore);
  const router = inject(Router);

  if (store.isLoggedIn()) return true;
  router.navigate(['/login']);
  return false;
};

export const premiumGuard: CanActivateFn = () => {
  const store  = inject(UserStore);
  const router = inject(Router);

  if (store.isPremium()) return true;
  router.navigate(store.isLoggedIn() ? ['/settings'] : ['/login']);
  return false;
};

export const adminGuard: CanActivateFn = () => {
  const store  = inject(UserStore);
  const router = inject(Router);

  if (store.isAdmin()) return true;
  router.navigate(['/dashboard']);
  return false;
};
