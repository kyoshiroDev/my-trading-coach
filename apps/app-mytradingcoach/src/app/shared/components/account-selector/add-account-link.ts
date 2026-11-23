/**
 * Lien « + Compte » du sélecteur de compte : ouvre la modale d'ajout de la page Mes comptes,
 * depuis n'importe quelle page. La page lit `?ajout=1`, ouvre la modale puis retire le paramètre.
 */
export const ADD_ACCOUNT_PARAM = 'ajout';
export const ADD_ACCOUNT_QUERY = { [ADD_ACCOUNT_PARAM]: '1' } as const;
