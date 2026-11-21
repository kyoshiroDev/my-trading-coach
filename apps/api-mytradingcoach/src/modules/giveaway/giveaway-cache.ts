/**
 * Clé Redis de l'état public du tirage mensuel (landing, page de l'app), sans dépendance : importée
 * par le module du tirage et par la suppression de compte (`UsersService.deleteMe`).
 */
export const GIVEAWAY_PUBLIC_CACHE_KEY = 'giveaway:public-state';
