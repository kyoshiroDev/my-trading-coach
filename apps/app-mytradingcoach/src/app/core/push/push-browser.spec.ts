import { describe, it, expect, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PUSH_BROWSER } from './push-browser';

/** Lien manifest lu dans le document réel, jamais un drapeau (revue phase 2 F4, #715). */
describe('PUSH_BROWSER.env : manifest', () => {
  afterEach(() => document.querySelectorAll('link[rel="manifest"]').forEach((l) => l.remove()));

  it('sans <link rel="manifest"> : hasManifest faux', () => {
    expect(TestBed.inject(PUSH_BROWSER).env().hasManifest).toBe(false);
  });

  it('avec <link rel="manifest"> : hasManifest vrai, lu à chaque appel', () => {
    const browser = TestBed.inject(PUSH_BROWSER);
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = '/manifest.webmanifest';
    document.head.appendChild(link);
    expect(browser.env().hasManifest).toBe(true);
  });
});
