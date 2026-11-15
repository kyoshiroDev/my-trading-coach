import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '@app/core/auth/auth.service';
import { DemoService } from '@app/core/services/demo.service';
import { ProductEventsService } from '@app/core/services/product-events.service';
import { PREMIUM_SIGNUP_TRIAL_DAYS } from '@mtc/shared';
import { DialogDirective } from '@mtc/front-ui';
import { DemoCtaComponent } from './demo-cta.component';
import TEMPLATE from './demo-cta.component.html?raw';

@Component({ template: '' })
class PageComponent {}

const q = (sel: string) => document.querySelector<HTMLElement>(sel);

async function setup(startUrl = '/dashboard') {
  const track = vi.fn();
  const endDemoSession = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'dashboard', component: PageComponent },
        { path: 'journal', component: PageComponent },
        { path: 'analytics', component: PageComponent },
        { path: 'register', component: PageComponent },
      ]),
      { provide: ProductEventsService, useValue: { track } },
      { provide: AuthService, useValue: { endDemoSession } },
    ],
  });
  TestBed.overrideComponent(DemoCtaComponent, {
    set: { template: TEMPLATE, imports: [DialogDirective], styleUrls: [], styleUrl: undefined as unknown as string },
  });
  const router = TestBed.inject(Router);
  // Le bandeau naît dans le shell, sur la 1re page de la démo.
  await router.navigateByUrl(startUrl);
  const fixture = TestBed.createComponent(DemoCtaComponent);
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  const render = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const navigate = async (url: string) => {
    await router.navigateByUrl(url);
    await render();
  };
  return { fixture, track, endDemoSession, router, render, navigate };
}

describe('DemoCtaComponent (bandeau d’inscription de la démo, #1029)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    TestBed.resetTestingModule();
  });

  it('affiche le bandeau, la durée d’essai partagée et un lien /register avec source=demo', async () => {
    const { track } = await setup();
    const banner = q('[data-testid="demo-cta-banner"]');
    expect(banner?.textContent).toContain(`${PREMIUM_SIGNUP_TRIAL_DAYS} jours de Premium offerts`);
    expect(banner?.textContent).toContain('sans carte');
    expect(banner?.textContent).not.toMatch(/€|\$/);
    // Une phrase par ligne (#1041).
    expect([...document.querySelectorAll('[data-testid="demo-cta-text"] .demo-cta-line')].map((l) => l.textContent?.trim())).toEqual([
      'Ça te parle ? Crée ton compte',
      `${PREMIUM_SIGNUP_TRIAL_DAYS} jours de Premium offerts`,
      'sans carte',
    ]);
    expect(q('[data-testid="demo-cta-banner-btn"]')?.getAttribute('href')).toBe('/register?utm_source=demo&source=demo');
    expect(track).toHaveBeenCalledWith('demo_cta_view', 'banner');
  });

  it('demo_cta_view une seule fois par visite', async () => {
    (await setup()).fixture.destroy();
    TestBed.resetTestingModule();
    const { track } = await setup();
    expect(track).not.toHaveBeenCalledWith('demo_cta_view', 'banner');
  });

  it('garde les UTM de la newsletter et le parrain de l’arrivée sur /demo', async () => {
    TestBed.inject(DemoService).captureOrigin('?utm_source=ninjatrader&utm_medium=newsletter&utm_campaign=newsletter-novembre-2026&ref=ABC');
    TestBed.resetTestingModule();
    await setup();
    const href = q('[data-testid="demo-cta-banner-btn"]')?.getAttribute('href') ?? '';
    const params = new URLSearchParams(href.split('?')[1]);
    expect(href.startsWith('/register?')).toBe(true);
    expect(params.get('utm_source')).toBe('ninjatrader');
    expect(params.get('utm_medium')).toBe('newsletter');
    expect(params.get('utm_campaign')).toBe('newsletter-novembre-2026');
    expect(params.get('ref')).toBe('ABC');
    expect(params.get('source')).toBe('demo');
  });

  it('la croix réduit en pastille, qui revient en grand à la page suivante', async () => {
    const { render, navigate } = await setup();
    q('[data-testid="demo-cta-close"]')?.click();
    await render();
    expect(q('[data-testid="demo-cta-banner"]')).toBeNull();
    expect(q('[data-testid="demo-cta-pill"]')?.textContent).toContain('Créer mon compte');
    await navigate('/journal');
    expect(q('[data-testid="demo-cta-banner"]')).not.toBeNull();
    expect(q('[data-testid="demo-cta-pill"]')).toBeNull();
  });

  it('clic : compté avec son placement, session démo effacée, puis /register dans l’app', async () => {
    const { render, track, endDemoSession, router } = await setup();
    q('[data-testid="demo-cta-close"]')?.click();
    await render();
    q('[data-testid="demo-cta-pill"]')?.click();
    await render();
    expect(track).toHaveBeenCalledWith('demo_cta_click', 'pill');
    expect(endDemoSession).toHaveBeenCalledTimes(1);
    expect(router.url).toBe('/register?utm_source=demo&source=demo');
  });

  it('relance une seule fois, après 60 s', async () => {
    const { render, track, navigate } = await setup();
    vi.advanceTimersByTime(59_000);
    await render();
    expect(q('[data-testid="demo-relance"]')).toBeNull();
    vi.advanceTimersByTime(2_000);
    await render();
    expect(q('[data-testid="demo-relance"]')?.textContent).toContain(
      'Avec ton compte, tu connectes ton Tradovate en lecture seule et tu suis ta marge en direct.',
    );
    expect(track).toHaveBeenCalledWith('demo_modal_shown');
    q('[data-testid="demo-relance-dismiss"]')?.click();
    await render();
    expect(q('[data-testid="demo-relance"]')).toBeNull();
    await navigate('/journal');
    await navigate('/analytics');
    vi.advanceTimersByTime(120_000);
    await render();
    expect(q('[data-testid="demo-relance"]')).toBeNull();
    expect(track.mock.calls.filter(([e]) => e === 'demo_modal_shown')).toHaveLength(1);
  });

  it('relance dès la 3e page vue, avant 60 s ; « Créer mon compte » compté modal', async () => {
    const { render, track, navigate } = await setup();
    await navigate('/journal');
    expect(q('[data-testid="demo-relance"]')).toBeNull();
    await navigate('/analytics');
    expect(q('[data-testid="demo-relance"]')).not.toBeNull();
    q('[data-testid="demo-relance-cta"]')?.click();
    await render();
    expect(track).toHaveBeenCalledWith('demo_cta_click', 'modal');
  });

  it('une page revue ou rechargée ne compte pas deux fois', async () => {
    const { navigate } = await setup();
    await navigate('/dashboard?tab=x');
    await navigate('/journal');
    await navigate('/journal');
    expect(q('[data-testid="demo-relance"]')).toBeNull();
    expect(sessionStorage.getItem('mtc_demo_pages')).toBe('2');
  });

  it('né pendant la navigation /demo → /dashboard : 1 seule page comptée, /demo jamais', async () => {
    TestBed.overrideComponent(DemoCtaComponent, {
      set: { template: TEMPLATE, imports: [DialogDirective], styleUrls: [], styleUrl: undefined as unknown as string },
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'demo', component: PageComponent },
          { path: 'dashboard', component: DemoCtaComponent },
        ]),
        { provide: ProductEventsService, useValue: { track: vi.fn() } },
        { provide: AuthService, useValue: { endDemoSession: vi.fn() } },
      ],
    });
    // Le bandeau est créé par l'activation de /dashboard, avant la fin de la navigation.
    const harness = await RouterTestingHarness.create('/demo');
    await harness.navigateByUrl('/dashboard', DemoCtaComponent);
    expect(sessionStorage.getItem('mtc_demo_pages')).toBe('1');
    expect(sessionStorage.getItem('mtc_demo_last_page')).toBe('/dashboard');
  });

  it('pas de relance pendant une saisie ni juste après un défilement', async () => {
    const { render } = await setup();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    vi.advanceTimersByTime(61_000);
    await render();
    expect(q('[data-testid="demo-relance"]')).toBeNull();
    input.blur();
    document.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(1_000);
    await render();
    expect(q('[data-testid="demo-relance"]')).toBeNull();
    vi.advanceTimersByTime(2_000);
    await render();
    expect(q('[data-testid="demo-relance"]')).not.toBeNull();
  });

  it('pas de relance par-dessus la fenêtre d’une action bloquée, qui compte « action »', async () => {
    const { render, track } = await setup();
    TestBed.inject(DemoService).promptSignup();
    await render();
    vi.advanceTimersByTime(61_000);
    await render();
    expect(q('[data-testid="demo-relance"]')).toBeNull();
    q('[data-testid="demo-action-cta"]')?.click();
    await render();
    expect(track).toHaveBeenCalledWith('demo_cta_click', 'action');
    expect(q('[data-testid="demo-action-prompt"]')).toBeNull();
  });
});
