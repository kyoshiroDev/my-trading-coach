/**
 * Insights IA : l'analyse réussie reste consultable pendant les 4 h du délai (C4 #1046). Avant, elle
 * ne vivait que dans le composant : quitter la page la perdait et le bouton restait bloqué 4 h.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LucideDynamicIcon } from '@lucide/angular';
import { AiInsightsComponent } from './ai-insights.component';
import { UserStore } from '@app/core/stores/user.store';
import { PaywallCtaService } from '@app/core/services/paywall-cta.service';
import TEMPLATE from './ai-insights.component.html?raw';

const GARDEE = {
  insights: [{ type: 'weakness', title: 'Revenge', description: 'Après une perte.', badge: 'Attention' }],
  topPattern: 'Revenge trading après 2 pertes',
  emotionInsight: 'STRESSED coûte cher.',
};

describe('Insights IA : dernière analyse relue à l’ouverture (C4 #1046)', () => {
  let http: HttpTestingController;

  async function ouvrir(cooldown: { cooldownSeconds: number; insights: unknown }) {
    TestBed.overrideComponent(AiInsightsComponent, {
      set: { template: TEMPLATE, styleUrl: undefined, styles: [], imports: [FormsModule, LucideDynamicIcon], schemas: [NO_ERRORS_SCHEMA] },
    });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: UserStore,
          useValue: { isPremium: signal(true), isDemo: signal(false), isAdmin: signal(false), user: signal({ id: 'u1' }) },
        },
        { provide: PaywallCtaService, useValue: { label: () => 'Passer à Premium →' } },
      ],
    });
    const fixture = TestBed.createComponent(AiInsightsComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/ai/cooldown')).flush({ data: cooldown });
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => http?.verify());

  it('analyse gardée par l’API : affichée à l’ouverture, sans relancer d’analyse', async () => {
    const el = await ouvrir({ cooldownSeconds: 12_000, insights: GARDEE });
    expect(el.textContent).toContain('Revenge trading après 2 pertes');
    expect(el.textContent).toContain('STRESSED coûte cher.');
    http.expectNone((r) => r.url.endsWith('/ai/insights'));
  });

  it('rien de gardé : écran d’invitation, comme avant', async () => {
    const el = await ouvrir({ cooldownSeconds: 0, insights: null });
    expect(el.textContent).not.toContain('Revenge trading');
  });
});
