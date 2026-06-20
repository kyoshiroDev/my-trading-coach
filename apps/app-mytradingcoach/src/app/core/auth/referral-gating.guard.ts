import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserStore } from '../stores/user.store';

/**
 * Gating par rôle (cohérent avec la sidebar) : une seule surface de parrainage.
 * - Un ambassadeur n'atterrit jamais sur la page Parrainage / Devenir ambassadeur.
 * - Un non-ambassadeur n'atterrit jamais sur la page Ambassadeur.
 */
export const parrainageGuard: CanActivateFn = () => {
  const store = inject(UserStore);
  const router = inject(Router);
  return store.isAmbassador() ? router.createUrlTree(['/ambassador']) : true;
};

export const ambassadorPageGuard: CanActivateFn = () => {
  const store = inject(UserStore);
  const router = inject(Router);
  return store.isAmbassador() ? true : router.createUrlTree(['/parrainage']);
};
