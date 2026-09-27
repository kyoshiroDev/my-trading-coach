import { HttpContextToken } from '@angular/common/http';

/**
 * Marque une requête dont les échecs ne doivent PAS produire de notification : l'écran gère
 * lui-même l'erreur (état d'erreur dédié, message inline), et un toast en plus ferait doublon.
 *
 * Usage : `http.get(url, { context: new HttpContext().set(SILENT_ERRORS, true) })`.
 */
export const SILENT_ERRORS = new HttpContextToken<boolean>(() => false);
