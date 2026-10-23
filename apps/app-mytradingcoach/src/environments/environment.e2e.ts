// Build `e2e` uniquement (tests Playwright, #694) : l'adresse de l'API se règle sans retoucher
// les fichiers compilés. Playwright la pose dans le localStorage avant le chargement de l'app
// (`storageState` de playwright.config.ts, variable E2E_API_URL) ; sinon http://localhost:3001.
const E2E_API_ORIGIN_KEY = 'mtc.e2e.apiOrigin';

function apiOrigin(): string {
  try {
    return localStorage.getItem(E2E_API_ORIGIN_KEY) || 'http://localhost:3001';
  } catch {
    return 'http://localhost:3001';
  }
}

const origin = apiOrigin();

export const environment = {
  production: false,
  apiUrl: `${origin}/api`,
  wsUrl: origin,
  appName: 'MyTradingCoach',
  appUrl: typeof location === 'undefined' ? 'http://localhost:4200' : location.origin,
  landingUrl: 'http://localhost:4321',
};
