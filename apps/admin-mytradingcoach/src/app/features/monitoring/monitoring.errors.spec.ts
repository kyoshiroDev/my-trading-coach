import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import type { VpsStats } from '@mtc/shared';
import { MonitoringComponent } from './monitoring.component';
import { VpsApi, type DockerContainer } from '../../core/api/vps.api';
import { AdminAuthService } from '../../core/auth/admin-auth.service';

// A22 (#1065) : une erreur autre que 503 VPS_UNREACHABLE était ignorée, et les dernières données
// restaient affichées comme si elles venaient d'être lues.
const stats = { cpu: 37, ram: { used: 1, total: 2 }, disk: { used: 1, total: 2 }, network: { up: 0, down: 0 }, uptime: 3600 } as unknown as VpsStats;
const ct: DockerContainer = { id: 'c1', name: 'mtc_api', image: 'api', status: 'running', cpu: 1, ram: 1, ramLimit: 2, ports: [] };
const fail = () => throwError(() => ({ status: 500, error: { message: 'Internal server error' } }));

async function render(health: () => unknown = () => of({ data: [] })) {
  const api = {
    servers: () => of({ data: [] }),
    stats: vi.fn().mockReturnValueOnce(of({ data: stats })).mockReturnValue(fail()),
    containers: vi.fn().mockReturnValueOnce(of({ data: [ct] })).mockReturnValue(fail()),
    healthHistory: vi.fn(health),
  };
  TestBed.configureTestingModule({
    providers: [{ provide: VpsApi, useValue: api }, { provide: AdminAuthService, useValue: { getAccessToken: () => null } }],
  });
  const fixture = TestBed.createComponent(MonitoringComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, fixture, api };
}

describe('Surveillance : erreurs hors 503 (A22 #1065)', () => {
  it('lecture en erreur : bandeau visible, données marquées comme celles de la dernière lecture réussie', async () => {
    const { el, fixture, api } = await render();
    expect(el.textContent).toContain('37%');
    expect(el.querySelector('[data-testid="poll-error"]')).toBeNull();

    (el.querySelector('.refresh-btn') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(api.stats).toHaveBeenCalledTimes(2);
    const banner = el.querySelector('[data-testid="poll-error"]');
    expect(banner?.textContent).toContain('n’ont pas pu être mises à jour');
    expect(banner?.textContent).toMatch(/dernière lecture réussie à \d{2}:\d{2}:\d{2}/);
  });

  it('historique de santé en erreur : message, pas une barre vide muette', async () => {
    const { el, api } = await render(fail);
    expect(el.querySelector('[data-testid="error-state"]')?.textContent).toContain('n’a pas pu être chargé');
    (el.querySelector('[data-testid="error-state-retry"]') as HTMLButtonElement).click();
    expect(api.healthHistory).toHaveBeenCalledTimes(2);
  });
});
