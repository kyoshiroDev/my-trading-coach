// URL de l'app Angular. Surchargée à la build via PUBLIC_APP_URL
// (ex. dev landing → https://dev.app.mytradingcoach.app). Défaut : prod.
export const APP_URL =
  import.meta.env.PUBLIC_APP_URL ?? 'https://app.mytradingcoach.app';

// URL de l'API (préfixe /api inclus, cf. setGlobalPrefix). Surchargée via PUBLIC_API_URL.
export const API_URL =
  import.meta.env.PUBLIC_API_URL ?? 'https://api.mytradingcoach.app/api';

// ── Publication gatée par feature (HARD) ──────────────────────────────────────
// On code tout, mais on ne publie une section/page que lorsque la feature derrière
// est en PROD. Sinon un visiteur voit une promesse sans rien derrière.
// Par défaut OFF. Mettre PUBLIC_FEATURE_* = "true" (build) quand la feature est live.
const flag = (v: string | undefined): boolean => v === 'true' || v === '1';

export const FEATURES = {
  // Section multi-comptes (home) + encart limites pricing + page /journal-trading-prop-firm.
  // Publier UNIQUEMENT quand le multi-comptes est validé en prod.
  multiAccounts: flag(import.meta.env.PUBLIC_FEATURE_MULTI_ACCOUNTS),
  // Section parrainage (home) + page /ambassadeur.
  // Publier UNIQUEMENT quand le système parrainage est shippé.
  referral: flag(import.meta.env.PUBLIC_FEATURE_REFERRAL),
} as const;
