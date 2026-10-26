import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import type { AccountPlanHint, PropFirmCatalogFirm, PropFirmPhaseSummary, PropFirmPlanSummary } from '@mtc/shared';
import { AccountsApi, type TradingAccount, type UpdateAccountPayload } from '@app/core/api/accounts.api';
import { PropFirmsApi } from '@app/core/api/prop-firms.api';
import { InstallPromptService } from '@app/core/install/install-prompt.service';
import { AccountPlanWizardComponent } from './account-plan-wizard.component';
import TEMPLATE from './account-plan-wizard.component.html?raw';

const phase = (kind: PropFirmPhaseSummary['phase'], size: number): PropFirmPhaseSummary => ({
  phase: kind, startingBalance: size, profitTarget: kind === 'evaluation' ? size * 0.06 : null,
  maxDrawdown: size * 0.04, drawdownType: 'trailing_eod', dailyLossLimit: 1000, dailyLossLimitStatus: 'known',
});
const plan = (id: string, planName: string, size: number, evalDrawdown: 'eod' | 'intraday' | null = null): PropFirmPlanSummary => ({
  id, planName, accountSize: size, currency: 'USD', availability: 'public',
  configuration: evalDrawdown ? { dailyLossLimit: null, evalDrawdown, payoutPath: null, addon: null } : null,
  needsReview: false, platformDependent: [], phases: [phase('evaluation', size), phase('funded', size)],
});
const CATALOG: PropFirmCatalogFirm[] = [
  {
    id: 'apex', name: 'Apex Trader Funding', website: '', verifiedAt: '2026-10-18',
    plans: [plan('apex-eod-50k', 'EOD Trail', 50_000, 'eod'), plan('apex-intraday-50k', 'Intraday Trail', 50_000, 'intraday'),
      plan('apex-eod-100k', 'EOD Trail', 100_000, 'eod')],
  },
  { id: 'lucid', name: 'Lucid Trading', website: '', verifiedAt: '2026-10-18', plans: [plan('lucid-flex-50k', 'LucidFlex', 50_000)] },
];

function mount(hint: AccountPlanHint | null) {
  const updates: UpdateAccountPayload[] = [];
  const accountsApi = {
    planHint: vi.fn(() => of({ data: hint })),
    update: vi.fn((_id: string, payload: UpdateAccountPayload) => {
      updates.push(payload);
      return of({ data: { id: 'a1', ...payload } as unknown as TradingAccount });
    }),
  };
  const installPrompt = { offer: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: InstallPromptService, useValue: installPrompt },
      { provide: AccountsApi, useValue: accountsApi },
      { provide: PropFirmsApi, useValue: { getCatalog: () => of({ data: CATALOG }) } },
    ],
  });
  TestBed.overrideComponent(AccountPlanWizardComponent, {
    set: { template: TEMPLATE, styleUrls: [], styleUrl: undefined as unknown as string },
  });
  const fixture = TestBed.createComponent(AccountPlanWizardComponent);
  const cmp = fixture.componentInstance as unknown as Record<string, unknown>;
  cmp['accountId'] = signal('a1');
  cmp['accountLabel'] = signal('Apex #1');
  const done: TradingAccount[] = [];
  fixture.componentInstance.done.subscribe((a) => done.push(a));
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null;
  const click = (id: string) => {
    const b = q(id);
    if (!b) throw new Error(`absent : ${id}`);
    b.click();
    fixture.detectChanges();
  };
  return { el, q, click, updates, done, accountsApi, fixture, installPrompt };
}

const APEX_HINT: AccountPlanHint = { externalName: 'APEX123456', env: 'demo', ownerIsLogin: false, startingBalance: 50_000 };

describe('AccountPlanWizardComponent — « Quel est ce compte ? »', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('pré-sélection : « On dirait un Apex 50K », Oui → programme → plan, phase et règles enregistrés', () => {
    const { q, click, updates, done } = mount(APEX_HINT);
    expect(q('apw-guess')!.textContent).toContain('Apex Trader Funding 50K');
    expect(q('apw-guess')!.textContent!.replace(/\s+/g, ' ')).toContain('50K (Évaluation), c\'est bien ça');
    click('apw-guess-yes');
    // Deux programmes Apex en 50K : le nom du compte ne dit pas lequel, on demande.
    click('apw-program-apex-intraday-50k');
    expect(updates).toEqual([expect.objectContaining({
      propFirmPlanId: 'apex-intraday-50k', type: 'EVALUATION', broker: 'Apex Trader Funding',
      accountSize: 50_000, profitTarget: 3000, maxDrawdown: 2000, drawdownType: 'TRAILING',
    })]);
    expect(done).toHaveLength(1);
  });

  it('sans pré-sélection : firm → taille → phase → programme unique relié aussitôt', () => {
    const { q, click, updates } = mount({ ...APEX_HINT, externalName: 'PTLOP123' });
    expect(q('apw-guess')).toBeNull();
    click('apw-firm-lucid');
    // Une seule taille : choisie d'office. Deux phases : on demande.
    click('apw-phase-funded');
    expect(updates).toEqual([expect.objectContaining({ propFirmPlanId: 'lucid-flex-50k', type: 'FUNDED' })]);
  });

  it('« Changer » repart du choix de la firm, « Retour » revient à la question', () => {
    const { q, click } = mount(APEX_HINT);
    click('apw-guess-change');
    expect(q('apw-firm-apex')).not.toBeNull();
    click('apw-back');
    expect(q('apw-guess-yes')).not.toBeNull();
  });

  it('« Plus tard » : aucun plan, compte marqué à renseigner', () => {
    const { click, updates, done } = mount(null);
    click('apw-later');
    expect(updates).toEqual([{ planLinkChoice: 'LATER' }]);
    expect(done).toHaveLength(1);
  });

  it('compte perso deviné (compte réel) : Oui → PERSONAL', () => {
    const { q, click, updates } = mount({ externalName: '1234567', env: 'live', ownerIsLogin: true, startingBalance: null });
    expect(q('apw-guess')!.textContent).toContain('compte perso');
    click('apw-guess-yes');
    expect(updates).toEqual([{ type: 'PERSONAL', propFirmPlanId: null, planLinkChoice: 'PERSONAL' }]);
  });

  it('« Ma firm n\'est pas dans la liste » : nom enregistré pour compléter le catalogue', () => {
    const { el, click, q, updates, fixture } = mount(null);
    click('apw-unlisted');
    expect(q('apw-unlisted-save')!.disabled).toBe(true);
    const input = el.querySelector('[data-testid="apw-unlisted-name"]') as HTMLInputElement;
    input.value = 'FTMO';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    click('apw-unlisted-save');
    expect(updates).toEqual([{ propFirmPlanId: null, planLinkChoice: 'UNLISTED', unlistedFirm: 'FTMO', broker: 'FTMO' }]);
  });

  it('installation de l’app : proposée (Premium) seulement quand un plan prop firm est relié', () => {
    const linked = mount(APEX_HINT);
    linked.click('apw-guess-yes');
    linked.click('apw-program-apex-intraday-50k');
    expect(linked.installPrompt.offer).toHaveBeenCalledExactlyOnceWith('plan-linked');
    TestBed.resetTestingModule();

    const later = mount(null);
    later.click('apw-later');
    expect(later.updates).toHaveLength(1);
    expect(later.installPrompt.offer).not.toHaveBeenCalled();
  });

  it('disclaimer d\'estimation toujours affiché', () => {
    const { el } = mount(null);
    expect(el.textContent).toContain('estimation MyTradingCoach, pas le calcul officiel de ta firm');
  });
});
