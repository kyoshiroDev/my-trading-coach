import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { BrokerMappingsComponent } from './broker-mappings.component';
import { AdminApi, type BrokerMappingRow } from '../../core/api/admin.api';

// A21 (#1065) : le registre des brokers ne doit pas taire ses erreurs.
const fiche = { id: 'f1', brokerName: 'Broker X', headerSample: 'a,b,c', pnlConfidence: 1, usageCount: 2, enabled: true, createdAt: '2026-11-01T00:00:00.000Z' } as BrokerMappingRow;

function render(api: Record<string, unknown>) {
  TestBed.configureTestingModule({
    providers: [{ provide: AdminApi, useValue: { planLinks: () => NEVER, ...api } }],
  });
  const fixture = TestBed.createComponent(BrokerMappingsComponent);
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, fixture };
}

const toggleBtn = (el: HTMLElement) =>
  [...el.querySelectorAll('button')].find((b) => /Désactiver|Réactiver/.test(b.textContent ?? '')) as HTMLButtonElement;

describe('Registre des brokers : erreurs (A21 #1065)', () => {
  it('liste en erreur : pas de « Aucune fiche », une erreur avec Réessayer qui recharge', () => {
    const brokerMappings = vi.fn()
      .mockReturnValueOnce(throwError(() => ({ status: 500 })))
      .mockReturnValueOnce(of({ data: [fiche] }));
    const { el, fixture } = render({ brokerMappings });
    expect(el.textContent).not.toContain('Aucune fiche');
    (el.querySelector('[data-testid="error-state-retry"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(brokerMappings).toHaveBeenCalledTimes(2);
    expect(el.textContent).toContain('Broker X');
    expect(el.querySelector('[data-testid="error-state"]')).toBeNull();
  });

  it('désactivation refusée : message visible ; bouton bloqué pendant la requête', () => {
    const pending = new Subject<never>();
    const setBrokerMappingEnabled = vi.fn()
      .mockReturnValueOnce(pending)
      .mockReturnValueOnce(throwError(() => ({ status: 404, error: { message: 'Fiche introuvable' } })));
    const { el, fixture } = render({ brokerMappings: () => of({ data: [fiche] }), setBrokerMappingEnabled });

    toggleBtn(el).click();
    fixture.detectChanges();
    expect(toggleBtn(el).disabled).toBe(true);
    toggleBtn(el).click();
    expect(setBrokerMappingEnabled).toHaveBeenCalledTimes(1);

    pending.error({ status: 500 });
    fixture.detectChanges();
    expect(toggleBtn(el).disabled).toBe(false);
    expect(el.querySelector('[data-testid="toggle-error"]')?.textContent).toContain('n’a pas pu être modifiée');

    toggleBtn(el).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="toggle-error"]')?.textContent).toContain('Fiche introuvable');
  });
});
