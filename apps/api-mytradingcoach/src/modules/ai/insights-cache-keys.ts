/**
 * Clés Redis des insights IA. Partagées par `AiService` (délai de 4 h, dernière analyse gardée) et
 * par la suppression du compte, qui les efface (#1056).
 */

/** Fenêtre de 4 h entre deux analyses d'insights. */
export const insightsCooldownKey = (userId: string) => `ai:cooldown:insights:${userId}`;

/** Dernière analyse d'insights réussie, relue à l'ouverture de l'écran (C4 #1046). */
export const insightsKeptKey = (userId: string) => `ai:insights:last:${userId}`;
