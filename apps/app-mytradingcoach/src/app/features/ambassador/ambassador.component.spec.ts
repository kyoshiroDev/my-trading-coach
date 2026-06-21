import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AmbassadorComponent } from './ambassador.component';
import { AmbassadorApi, AmbassadorStats } from '../../core/api/ambassador.api';
import { ReferralApi } from '../../core/api/referral.api';
import { AmbassadorNotifService } from '../../core/services/ambassador-notif.service';

function makeStats(partial: Partial<AmbassadorStats> = {}): AmbassadorStats {
  return {
    referralCode: 'VAL',
    referrals: [],
    total: 5,
    free: 3,
    starter: 1,
    premium: 1,
    earningsByMonth: {},
    totalEarned: 94.4,
    pendingPayout: 23.6,
    ...partial,
  };
}

function setup(referralOverride: Partial<Record<'generateStatement', unknown>> = {}) {
  const ambassadorApi = { getStats: vi.fn(() => of({ data: makeStats() })) };
  const referralApi = {
    generateStatement: vi.fn(() => of(new Blob(['pdf'], { type: 'application/pdf' }))),
    ...referralOverride,
  };
  const notif = { markSeen: vi.fn() };

  TestBed.configureTestingModule({
    providers: [
      { provide: AmbassadorApi, useValue: ambassadorApi },
      { provide: ReferralApi, useValue: referralApi },
      { provide: AmbassadorNotifService, useValue: notif },
    ],
  });
  TestBed.overrideComponent(AmbassadorComponent, {
    set: {
      template: '<div></div>',
      styleUrls: [],
      styleUrl: undefined as unknown as string,
      schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const fixture = TestBed.createComponent(AmbassadorComponent);
  fixture.detectChanges();
   
  return { fixture, cmp: fixture.componentInstance as any, referralApi };
}

describe('AmbassadorComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    // jsdom n'implémente pas createObjectURL/revokeObjectURL.
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('génère le relevé via ReferralApi et déclenche le téléchargement', () => {
    const { cmp, referralApi } = setup();
    cmp.generateStatement();
    expect(referralApi.generateStatement).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(cmp.statementLoading()).toBe(false);
    expect(cmp.statementError()).toBe(false);
  });

  it('remonte une erreur de relevé sans casser le composant', () => {
    const { cmp } = setup({ generateStatement: vi.fn(() => throwError(() => new Error('boom'))) });
    cmp.generateStatement();
    expect(cmp.statementError()).toBe(true);
    expect(cmp.statementLoading()).toBe(false);
  });

  it('construit le lien de parrainage à partir du code', () => {
    const { cmp } = setup();
    expect(cmp.referralLink()).toContain('ref=VAL');
  });
});
