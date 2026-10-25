/**
 * Réglages des e2e lus dans l'environnement (#694). Les ports et l'adresse de l'API servie à
 * l'app se règlent dans playwright.config.ts (E2E_APP_PORT, BASE_URL, E2E_API_URL).
 *
 * - `E2E_API_URL` (http://localhost:3001) : origine de l'API, même valeur que dans la config.
 * - `LOAD_TEST_KEY` : même clé que celle de l'API de test. Présente, l'inscription compte ses
 *   requêtes par client virtuel au lieu de l'IP (load-test-tracker.ts côté API), donc les
 *   comptes créés par la suite ne butent plus sur la limite de 10 inscriptions par heure et par IP.
 *   Absente : aucun changement.
 */
export const E2E_API_URL = (process.env['E2E_API_URL'] ?? 'http://localhost:3001').replace(/\/+$/, '');
export const LOAD_TEST_KEY = process.env['LOAD_TEST_KEY'] ?? '';
