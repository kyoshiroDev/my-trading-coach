import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DEMO_ORIGIN_KEY, DemoService } from './demo.service';

describe('DemoService — origine de la visite et lien d’inscription (#1029)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  it('sans origine : /register?utm_source=demo&source=demo (jamais #pricing)', () => {
    expect(TestBed.inject(DemoService).registerUrl()).toBe('/register?utm_source=demo&source=demo');
  });

  it('garde les UTM et le parrain de /demo pour l’onglet, même après un rechargement', () => {
    TestBed.inject(DemoService).captureOrigin('?utm_source=ninjatrader&utm_medium=newsletter&ref=ABC');
    TestBed.resetTestingModule();
    const demo = TestBed.inject(DemoService);
    demo.captureOrigin('');
    expect(demo.registerUrl()).toBe('/register?utm_source=ninjatrader&utm_medium=newsletter&ref=ABC&source=demo');
  });

  it('ignore un contenu de stockage illisible', () => {
    sessionStorage.setItem(DEMO_ORIGIN_KEY, '{oops');
    expect(TestBed.inject(DemoService).registerUrl()).toBe('/register?utm_source=demo&source=demo');
  });
});
