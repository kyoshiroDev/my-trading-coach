import { describe, expect, it } from 'vitest';
import { isLandingEngagementStep, landingEngagementPage, scrollDepthPercent } from './landing-engagement';

describe('landingEngagementPage', () => {
  it('garde l’accueil et /prop-firm, avec ou sans / final', () => {
    expect(landingEngagementPage('/')).toBe('/');
    expect(landingEngagementPage('/prop-firm')).toBe('/prop-firm');
    expect(landingEngagementPage('/prop-firm/')).toBe('/prop-firm');
  });

  it('refuse les autres pages et les valeurs absentes', () => {
    expect(landingEngagementPage('/blog/revenge-trading')).toBeNull();
    expect(landingEngagementPage('/prop-firm/x')).toBeNull();
    expect(landingEngagementPage('')).toBe('/');
    expect(landingEngagementPage(undefined)).toBe('/');
  });
});

describe('isLandingEngagementStep', () => {
  it('distingue les étapes d’engagement de celles de l’inscription', () => {
    expect(isLandingEngagementStep('scroll_depth')).toBe(true);
    expect(isLandingEngagementStep('rules_use')).toBe(true);
    expect(isLandingEngagementStep('cta_click')).toBe(false);
  });
});

describe('scrollDepthPercent', () => {
  it('bas de l’écran / hauteur du document, arrondi par défaut', () => {
    expect(scrollDepthPercent(0, 800, 4000)).toBe(20);
    expect(scrollDepthPercent(1200, 800, 4000)).toBe(50);
    expect(scrollDepthPercent(2199, 800, 4000)).toBe(74);
  });

  it('100 à moins de 4 px du bas, et pour une page plus courte que l’écran', () => {
    expect(scrollDepthPercent(3197, 800, 4000)).toBe(100);
    expect(scrollDepthPercent(0, 800, 600)).toBe(100);
  });

  it('document vide → 0', () => {
    expect(scrollDepthPercent(0, 800, 0)).toBe(0);
  });
});
