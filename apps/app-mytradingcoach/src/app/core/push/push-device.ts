import type { BrowserEnv } from './push-browser';

/**
 * Détection de l'appareil (lit `BrowserEnv` de `push-browser.ts`), partagée par le push (`push.service.ts`) et l'installation de l'app
 * (`core/install/install-prompt.service.ts`). Ne pas la dupliquer ailleurs.
 */

/** Navigateurs intégrés aux applis (Instagram, Facebook, X, TikTok…) : ni push fiable, ni installation. */
const IN_APP_BROWSER = /Instagram|FBAN|FBAV|FB_IAB|Line\/|Snapchat|musical_ly|BytedanceWebview|LinkedInApp|Twitter/i;

export function isInAppBrowser(env: BrowserEnv): boolean {
  return IN_APP_BROWSER.test(env.userAgent);
}

/** iPhone, iPod, ou iPad (qui se présente en Mac avec un écran tactile). */
export function isIos(env: BrowserEnv): boolean {
  return /iPhone|iPad|iPod/.test(env.userAgent) || (env.userAgent.includes('Macintosh') && env.maxTouchPoints > 1);
}

/** iPhone sur un autre navigateur que Safari (Chrome, Firefox, Edge, Opera) : pas d'ajout à l'écran d'accueil. */
export function isIosOtherBrowser(env: BrowserEnv): boolean {
  return isIos(env) && /CriOS|FxiOS|EdgiOS|OPiOS/.test(env.userAgent);
}

export function isAndroid(env: BrowserEnv): boolean {
  return /Android/i.test(env.userAgent);
}

/** Plateforme des événements d'usage (`place` de `ProductEventDaily`, liste `INSTALL_PLACES` de l'API). */
export type DevicePlace = 'android' | 'ios' | 'ios-other' | 'desktop';

export function devicePlace(env: BrowserEnv): DevicePlace {
  if (isIos(env)) return isIosOtherBrowser(env) ? 'ios-other' : 'ios';
  return isAndroid(env) ? 'android' : 'desktop';
}
