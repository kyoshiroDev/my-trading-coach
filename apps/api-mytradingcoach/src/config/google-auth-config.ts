/** Configuration publique de la connexion Google (#618), renvoyée telle quelle au front. */
export type GoogleAuthConfig =
  | { enabled: true; clientId: string }
  | { enabled: false; clientId: null };

/**
 * Activée seulement si `FEATURE_GOOGLE_AUTH=true` ET `GOOGLE_CLIENT_ID` défini : un flag oublié
 * ou un client absent coupe le bouton (front) et la route (API), jamais d'erreur au démarrage.
 * Lue à chaque appel : un test peut changer l'env sans recréer le module.
 */
export function resolveGoogleAuthConfig(env: NodeJS.ProcessEnv): GoogleAuthConfig {
  const clientId = env['GOOGLE_CLIENT_ID']?.trim();
  if (env['FEATURE_GOOGLE_AUTH'] !== 'true' || !clientId) return { enabled: false, clientId: null };
  return { enabled: true, clientId };
}
