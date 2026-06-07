// URL de l'app Angular. Surchargée à la build via PUBLIC_APP_URL
// (ex. dev landing → https://dev.app.mytradingcoach.app). Défaut : prod.
export const APP_URL =
  import.meta.env.PUBLIC_APP_URL ?? 'https://app.mytradingcoach.app';

// URL de l'API. Surchargée à la build via PUBLIC_API_URL. Défaut : prod.
export const API_URL =
  import.meta.env.PUBLIC_API_URL ?? 'https://api.mytradingcoach.app';
