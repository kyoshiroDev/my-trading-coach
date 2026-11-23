/**
 * Purge des comptes inactifs (#824, décision de Greg du 2026-11-23, recommandation CNIL) : un compte
 * sans connexion depuis 2 ans est supprimé, après un e-mail de préavis chaque semaine du dernier mois.
 * Source unique des durées (API, politique de confidentialité, e-mails).
 */
export const INACTIVITY_PURGE_DAYS = 730;
/** Préavis envoyés avant la suppression : J-28, J-21, J-14, J-7. */
export const INACTIVITY_NOTICE_COUNT = 4;
/** Écart entre deux préavis, et entre le dernier préavis et la suppression (jours calendaires de Paris). */
export const INACTIVITY_NOTICE_INTERVAL_DAYS = 7;
