/**
 * Interrupteurs des alertes de comportement (#602, #671), lus à chaque appel (pas mis en cache) pour
 * qu'un changement de variable prenne effet au redémarrage sans autre réglage. Fonctions pures : importables
 * sans dépendre d'un service (anti-tilt, garde des routes, configuration de l'app).
 */

/** Enregistrement des alertes : actif sauf `BEHAVIOR_ALERTS_RECORD=false` (interrupteur d'urgence). */
export const behaviorAlertsRecordEnabled = () => process.env['BEHAVIOR_ALERTS_RECORD'] !== 'false';
/** Affichage dans l'app : `BEHAVIOR_ALERTS_UI=true` seulement. Absente ou autre valeur : éteint. */
export const behaviorAlertsUiEnabled = () => process.env['BEHAVIOR_ALERTS_UI'] === 'true';
