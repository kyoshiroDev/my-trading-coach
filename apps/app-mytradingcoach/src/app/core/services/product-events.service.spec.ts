import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ProductEventsService } from './product-events.service';

function setup(url: string, post = vi.fn(() => of(null))) {
  TestBed.configureTestingModule({
    providers: [
      { provide: HttpClient, useValue: { post } },
      { provide: Router, useValue: { url } },
    ],
  });
  return { service: TestBed.inject(ProductEventsService), post };
}

describe('ProductEventsService — entonnoir Premium', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('écran = 1er segment de la route, sans query ni caractère libre', () => {
    for (const [url, place] of [['/ai-insights?tab=week', 'ai-insights'], ['/', 'dashboard'], ['/session#live', 'session']]) {
      TestBed.resetTestingModule();
      expect(setup(url).service.place()).toBe(place);
    }
  });

  it('track : un événement et un écran, rien d’autre', () => {
    const { service, post } = setup('/analytics');
    service.track('plan_modal_open');
    expect(post).toHaveBeenCalledWith(expect.stringMatching(/\/events$/), { event: 'plan_modal_open', place: 'analytics' });
  });

  it('once : un cadenas re-rendu sur le même écran ne compte qu’une fois', () => {
    const { service, post } = setup('/scoring');
    service.once('premium_seen');
    service.once('premium_seen');
    service.once('premium_seen', 'analytics');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('une erreur réseau ne remonte jamais', () => {
    const { service } = setup('/scoring', vi.fn(() => throwError(() => new Error('offline'))));
    expect(() => service.track('trial_click')).not.toThrow();
  });
});
