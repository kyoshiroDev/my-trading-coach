import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of, throwError } from 'rxjs';
import { provideRouter } from '@angular/router';
import { ReferralComponent } from './referral.component';
import { ReferralApi, MyReferral } from '../../core/api/referral.api';

function makeData(partial: Partial<MyReferral> = {}): MyReferral {
  return {
    referralCode: 'GREG4K',
    link: 'https://mytradingcoach.app/?ref=GREG4K',
    invited: 5,
    subscribed: 3,
    freeMonthsEarned: 3,
    creditAvailable: 1,
    filleuls: [
      { pseudo: 'Maxime S.', date: '2026-06-18', status: 'payant', rewarded: true },
      { pseudo: 'Sarah R.', date: '2026-06-11', status: 'essai', rewarded: false },
    ],
    ...partial,
  };
}

function setup(apiOverride: Partial<Record<'getMyReferral', unknown>> = {}) {
  const api = {
    getMyReferral: vi.fn(() => of({ data: makeData() })),
    ...apiOverride,
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: ReferralApi, useValue: api },
    ],
  });
  TestBed.overrideComponent(ReferralComponent, {
    set: { styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(ReferralComponent);
  fixture.detectChanges();
   
  return { fixture, cmp: fixture.componentInstance as any, api };
}

describe('ReferralComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('charge et affiche les données de parrainage', () => {
    const { fixture, api } = setup();
    expect(api.getMyReferral).toHaveBeenCalled();
    // Le lien (avec le code) est dans l'input readonly du hero → lire sa valeur.
    const linkInput = fixture.nativeElement.querySelector('.link-input') as HTMLInputElement;
    expect(linkInput?.value).toContain('GREG4K');
    expect(fixture.nativeElement.textContent as string).toContain('Maxime S.');
  });

  it('calcule la progression vers l’objectif des 12 filleuls payants', () => {
    const { cmp } = setup();
    expect(cmp.goalPercent()).toBe(25); // 3 / 12
    expect(cmp.goalRemaining()).toBe(9);
  });

  it('affiche un état d’erreur si l’appel échoue', () => {
    const { cmp } = setup({ getMyReferral: vi.fn(() => throwError(() => new Error('boom'))) });
    expect(cmp.error()).toBe(true);
    expect(cmp.isLoading()).toBe(false);
  });

  it('mappe les statuts de filleul vers les bons libellés', () => {
    const { cmp } = setup();
    expect(cmp.statusLabel('payant')).toBe('Abonné payant');
    expect(cmp.statusLabel('essai')).toBe('En essai');
    expect(cmp.statusLabel('inscrit')).toBe('Inscrit');
  });
});
