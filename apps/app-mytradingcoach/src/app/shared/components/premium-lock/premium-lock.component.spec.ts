import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef, signal } from '@angular/core';
import * as angularCore from '@angular/core';
import { PremiumLockComponent } from './premium-lock.component';
import { OffersStore } from '@app/core/stores/offers.store';
import { UserStore } from '@app/core/stores/user.store';
import { OfferIntentService } from '@app/core/services/offer-intent.service';
import { ProductEventsService } from '@app/core/services/product-events.service';

// Cadenas Premium (#525) : mentionne l'offre fondateur si elle est accessible, et ouvre la modale
// (cta=cadenas) au lieu de l'ancien lien vers /parametres, une route inexistante.

const resolveComponentResources = (
  angularCore as Record<string, unknown>
)['ɵresolveComponentResources'] as (
  resolver: (url: string) => Promise<{ text(): Promise<string> }>,
) => Promise<void>;

beforeAll(async () => {
  // styleUrl en JIT : feuille vide (seul le DOM est testé).
  await resolveComponentResources(() =>
    Promise.resolve({ text: () => Promise.resolve('') } as unknown as Response),
  );
});

function render(founderAvailable: boolean, trialAvailable = true) {
  const intent = { open: vi.fn() };
  TestBed.configureTestingModule({
    imports: [PremiumLockComponent],
    providers: [
      { provide: OffersStore, useValue: { founderAvailable: signal(founderAvailable), load: vi.fn() } },
      { provide: UserStore, useValue: { trialAvailable: signal(trialAvailable), user: signal({ id: 'u1' }), isPremium: signal(false) } },
      { provide: OfferIntentService, useValue: intent },
      { provide: ProductEventsService, useValue: { once: vi.fn(), track: vi.fn() } },
    ],
  });
  const fixture = TestBed.createComponent(PremiumLockComponent);
  fixture.detectChanges();
  const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid=premium-lock-cta]')!;
  return { button, intent, fixture };
}

describe('PremiumLockComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('offre fondateur accessible : « 29 €/mois à vie (offre fondateur) » (E3 #1013)', () => {
    expect(render(true).button.textContent).toContain('Passer à Premium · 29 €/mois à vie (offre fondateur)');
  });

  it('sinon : « 30 jours d’essai » (Q1 #1013), ou passage direct si l’essai est consommé', () => {
    expect(render(false).button.textContent).toContain("Essayer Premium · 30 jours d'essai");
    TestBed.resetTestingModule();
    expect(render(false, false).button.textContent).toContain('Passer à Premium');
  });

  it('clic : ouvre la modale avec cta=cadenas (plus de lien vers /parametres)', () => {
    const { button, intent } = render(true);
    expect(button.tagName).toBe('BUTTON');
    button.click();
    expect(intent.open).toHaveBeenCalledWith('cadenas');
  });
});

describe('PremiumLockComponent · mise en page (#1178)', () => {
  const css = readFileSync(join(import.meta.dirname, 'premium-lock.component.css'), 'utf8');
  const bloc = (sel: string) => css.match(new RegExp(`${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

  it('carte : passage à la ligne, jamais plus large que son bloc (le texte tombait à 37 px dès 1440 px)', () => {
    const content = bloc('.pl-content');
    expect(content).toContain('flex-wrap: wrap');
    // Largeur selon le contenu (petits emplacements de la séance du matin), bornée au bloc.
    expect(content).toContain('max-width: min(360px, calc(100% - 32px))');
    expect(content).not.toMatch(/(^|[^-])width: min/);
    expect(bloc('.pl-text')).toContain('flex: 1 1 200px');
  });
});

describe('PremiumLockComponent · composant conforme (#1189)', () => {
  beforeEach(() => TestBed.resetTestingModule());
  const css = readFileSync(join(import.meta.dirname, 'premium-lock.component.css'), 'utf8');

  it('icône cadenas Lucide (jamais « ✦ »), titre en h3 via l’entrée heading', () => {
    const { button } = render(false);
    const root = button.closest('[data-testid=premium-lock]')!;
    expect(root.textContent).not.toContain('✦');
    expect(root.querySelector('svg.pl-icon')).not.toBeNull();
    expect(root.querySelector('h3.pl-title')?.textContent?.trim()).toBe('Fonctionnalité Premium');
  });

  it('entrée heading (et subtitle) reliée au h3 et au sous-titre', () => {
    const { fixture } = render(false);
    // En JIT (vitest), une entrée signal n'est pas affectable par setInput : on remplace le signal.
    const cmp = fixture.componentInstance as unknown as Record<string, unknown>;
    cmp['heading'] = signal('Equity Curve');
    cmp['subtitle'] = signal('Visualise ton capital');
    fixture.componentRef.injector.get(ChangeDetectorRef).markForCheck(); // OnPush
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h3.pl-title')?.textContent?.trim()).toBe('Equity Curve');
    expect(el.querySelector('.pl-sub')?.textContent?.trim()).toBe('Visualise ton capital');
  });

  it('aucun usage de <mtc-premium-lock> avec title= (info-bulle native) : heading= partout', () => {
    const appDir = join(import.meta.dirname, '..', '..', '..');
    const templates = (readdirSync(appDir, { recursive: true }) as string[]).filter((f) => f.endsWith('.html'));
    const usages = templates.flatMap((f) => readFileSync(join(appDir, f), 'utf8').match(/<mtc-premium-lock\b[\s\S]*?\/?>/g) ?? []);
    expect(usages.length).toBeGreaterThanOrEqual(5);
    for (const u of usages) {
      expect(u).toMatch(/\bheading=/);
      expect(u).not.toMatch(/(^|\s)\[?title\]?=/);
    }
  });

  it('couleurs en tokens : ni rgba ni violet ; seul #fff (texte sur --primary)', () => {
    expect(css).not.toMatch(/rgba?\(/);
    expect(css).not.toContain('--purple');
    const sansCommentaires = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sansCommentaires.match(/#[0-9a-fA-F]{3,6}\b/g) ?? []).toEqual(['#fff']);
  });

  it('bouton jamais plus large que la carte : passage à la ligne permanent (libellé fondateur ~340 px)', () => {
    const btn = css.match(/\.pl-btn\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(btn).toMatch(/white-space:\s*normal/);
    expect(btn).toMatch(/max-width:\s*100%/);
    expect(btn).not.toContain('nowrap');
    expect(css).toContain('container-type: inline-size');
    expect(css).toMatch(/@container\s*\(max-width:\s*340px\)\s*\{\s*\.pl-btn\s*\{[^}]*flex-basis:\s*100%/);
  });

  it('libellé fondateur rendu dans le bouton (le plus long des libellés)', () => {
    expect(render(true).button.textContent).toContain('(offre fondateur)');
  });
});
