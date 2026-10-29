import { DeferBlockBehavior, TestBed } from '@angular/core/testing';
import { ConfirmService } from '@mtc/front-ui';
import * as angularCore from '@angular/core';
import { App } from './app';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { ToastsComponent } from './shared/components/toasts/toasts.component';

// Le conteneur de toasts a un templateUrl/styleUrl : en JIT sous vitest, ses ressources
// doivent être résolues avant que le composant racine ne le référence (même parade que les
// specs d'onboarding).
const resolveComponentResources = (angularCore as Record<string, unknown>)[
  'ɵresolveComponentResources'
] as (resolver: (url: string) => Promise<{ text(): Promise<string> }>) => Promise<void>;

describe('App', () => {
  beforeAll(async () => {
    await resolveComponentResources(() =>
      Promise.resolve({ text: () => Promise.resolve('') } as unknown as Response),
    );
  });

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient()],
      deferBlockBehavior: DeferBlockBehavior.Playthrough,
    });
    // Icônes Lucide neutralisées (ne compilent pas en JIT) ; surcharge AVANT compileComponents().
    TestBed.overrideComponent(ToastsComponent, {
      set: { template: '<div class="toasts"></div>', imports: [], styleUrls: [], styleUrl: undefined as unknown as string },
    });
    await TestBed.compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('monte le conteneur de toasts UNE seule fois, à la racine (hors routeur)', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('mtc-toasts')).toHaveLength(1);
  });

  it("retire l'écran de chargement d'index.html une fois la première page affichée", async () => {
    const boot = document.createElement('div');
    boot.id = 'mtc-boot';
    document.body.appendChild(boot);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(document.getElementById('mtc-boot')).not.toBeNull();

    await TestBed.inject(Router).navigateByUrl('/');
    await fixture.whenStable();
    expect(document.getElementById('mtc-boot')).toBeNull();
  });

  it('dialogue de confirmation chargé à la première demande seulement (budget du bundle)', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('mtc-confirm-dialog')).toBeNull();

    void TestBed.inject(ConfirmService).ask({ title: 'Supprimer ?', message: 'Ce trade sera supprimé.' });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelectorAll('mtc-confirm-dialog')).toHaveLength(1);
  });
});
