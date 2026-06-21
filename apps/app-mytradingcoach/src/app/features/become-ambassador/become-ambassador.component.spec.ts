import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of, throwError } from 'rxjs';
import { provideRouter } from '@angular/router';
import { BecomeAmbassadorComponent } from './become-ambassador.component';
import { ReferralApi } from '../../core/api/referral.api';

function setup(apiOverride: Partial<Record<'applyAmbassador', unknown>> = {}) {
  const api = {
    applyAmbassador: vi.fn(() => of({ data: { success: true } })),
    ...apiOverride,
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: ReferralApi, useValue: api },
    ],
  });
  TestBed.overrideComponent(BecomeAmbassadorComponent, {
    set: { styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(BecomeAmbassadorComponent);
  fixture.detectChanges();
   
  return { fixture, cmp: fixture.componentInstance as any, api };
}

describe('BecomeAmbassadorComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('bloque l’envoi tant que les réseaux ne sont pas renseignés', () => {
    const { cmp } = setup();
    expect(cmp.canSubmit()).toBe(false);
    cmp.socials.set('@montrading');
    expect(cmp.canSubmit()).toBe(true);
  });

  it('appelle applyAmbassador avec les réseaux et le message', () => {
    const { cmp, api } = setup();
    cmp.socials.set('  @montrading  ');
    cmp.message.set('  Je coache 5k traders  ');
    cmp.submit();
    expect(api.applyAmbassador).toHaveBeenCalledWith({
      socials: '@montrading',
      message: 'Je coache 5k traders',
    });
    expect(cmp.submitted()).toBe(true);
  });

  it('affiche le message de validation manuelle après envoi', () => {
    const { fixture, cmp } = setup();
    cmp.socials.set('@montrading');
    cmp.submit();
    fixture.detectChanges();
    const html = fixture.nativeElement.textContent as string;
    expect(html).toContain('Demande envoyée');
    expect(html.toLowerCase()).toContain('manuellement');
  });

  it('remonte une erreur si l’envoi échoue', () => {
    const { cmp } = setup({ applyAmbassador: vi.fn(() => throwError(() => new Error('boom'))) });
    cmp.socials.set('@montrading');
    cmp.submit();
    expect(cmp.error()).toBe(true);
    expect(cmp.submitted()).toBe(false);
  });
});
