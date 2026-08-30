/**
 * Sidebar — le repli en icônes appartient à l'onglet Session live, pas à la journée.
 *
 * Le déclencheur était `SessionStore.hasActiveSession()`, c'est-à-dire « une session est
 * ouverte » — un état qui dure toute la séance. La sidebar restait donc repliée sur le
 * Dashboard, le Journal et partout ailleurs tant que la session n'était pas clôturée,
 * alors que le mode focus ne concerne que la vue live.
 *
 * Comportement voulu, et vérifié ici :
 *  - onglet Session live         → repliée, avec possibilité de déplier à la main ;
 *  - partout ailleurs            → dépliée, avec possibilité de replier à la main ;
 *  - session ouverte mais autre écran → dépliée (c'était le bug).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { SidebarComponent } from './sidebar.component';
import { LiveModeService } from '../../../core/services/live-mode.service';
import { UserStore } from '../../../core/stores/user.store';
import { AuthService } from '../../../core/auth/auth.service';
import { UsersApi } from '../../../core/api/users.api';
import { DemoService } from '../../../core/services/demo.service';
import { AmbassadorNotifService } from '../../../core/services/ambassador-notif.service';

function mount() {
  localStorage.clear();
  const live = new LiveModeService();

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: LiveModeService, useValue: live },
      {
        provide: UserStore,
        useValue: {
          isPremium: () => false, isDemo: () => false, isAmbassador: () => false,
          displayName: () => 'Test', initials: () => 'TE',
          user: () => ({ onboardingCompleted: true }),
        },
      },
      {
        provide: AuthService,
        useValue: { isAuthenticated: () => false, fetchMe: () => of(null), logout: vi.fn() },
      },
      { provide: UsersApi, useValue: { finishOnboarding: () => of({ data: {} }) } },
      { provide: AmbassadorNotifService, useValue: { newReferrals: () => 0 } },
      { provide: DemoService, useValue: { showSignupPrompt: () => false, dismiss: vi.fn() } },
    ],
  });
  TestBed.overrideComponent(SidebarComponent, {
    set: {
      template: '<div></div>', imports: [], styleUrls: [],
      styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const fixture = TestBed.createComponent(SidebarComponent);
  fixture.detectChanges();
  return { cmp: fixture.componentInstance as any, live, fixture };
}

describe('Sidebar — repli lié à la vue Session live', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('au repos : dépliée', () => {
    const { cmp } = mount();
    expect(cmp.collapsed()).toBe(false);
  });

  it('entrer sur l\'onglet live → repliée', () => {
    const { cmp, live, fixture } = mount();

    live.activate();
    fixture.detectChanges();

    expect(cmp.collapsed()).toBe(true);
  });

  it('quitter l\'onglet live → redépliée, même si la session reste ouverte', () => {
    // C'EST LE BUG : `deactivate()` est appelé au changement d'onglet et en quittant la
    // route, indépendamment de la clôture de session. La sidebar doit suivre la vue.
    const { cmp, live, fixture } = mount();
    live.activate();
    fixture.detectChanges();
    expect(cmp.collapsed()).toBe(true);

    live.deactivate(); // passage sur Dashboard / Journal / onglet Débrief
    fixture.detectChanges();

    expect(
      cmp.collapsed(),
      'La sidebar reste repliée hors de la vue live : le focus déborde sur tout le produit',
    ).toBe(false);
  });

  it('déplier à la main pendant le live tient', () => {
    const { cmp, live, fixture } = mount();
    live.activate();
    fixture.detectChanges();

    cmp.toggleCollapse(); // l'utilisateur redéploie
    fixture.detectChanges();

    expect(cmp.collapsed()).toBe(false);
  });

  it('replier à la main hors live tient', () => {
    const { cmp, fixture } = mount();

    cmp.toggleCollapse();
    fixture.detectChanges();

    expect(cmp.collapsed()).toBe(true);
  });

  it('une préférence « repliée » est restaurée en sortant du live', () => {
    const { cmp, live, fixture } = mount();
    cmp.toggleCollapse(); // préférence : repliée
    expect(cmp.collapsed()).toBe(true);

    live.activate();
    fixture.detectChanges();
    live.deactivate();
    fixture.detectChanges();

    expect(
      cmp.collapsed(),
      'La sortie du live a écrasé la préférence de l\'utilisateur',
    ).toBe(true);
  });

  it('aller-retour live → hors live → live reste cohérent', () => {
    const { cmp, live, fixture } = mount();

    live.activate();   fixture.detectChanges();
    expect(cmp.collapsed()).toBe(true);
    live.deactivate(); fixture.detectChanges();
    expect(cmp.collapsed()).toBe(false);
    live.activate();   fixture.detectChanges();
    expect(cmp.collapsed()).toBe(true);
  });
});
