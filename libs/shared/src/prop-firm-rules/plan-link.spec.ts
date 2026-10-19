import { describe, expect, it } from 'vitest';
import { needsPlanLink, type PlanLinkState } from './plan-link';

const acc = (over: Partial<PlanLinkState>): PlanLinkState => ({
  propFirmPlanId: null, status: 'ACTIVE', type: 'EVALUATION', planLinkChoice: null, ...over,
});

describe('needsPlanLink', () => {
  it('compte prop firm sans plan : à relier', () => {
    expect(needsPlanLink(acc({}))).toBe(true);
    expect(needsPlanLink(acc({ type: 'FUNDED' }))).toBe(true);
  });

  it('« Plus tard » : reste à relier, même typé perso', () => {
    expect(needsPlanLink(acc({ planLinkChoice: 'LATER', type: 'PERSONAL' }))).toBe(true);
  });

  it('relié, archivé, perso ou firm absente : rien à proposer', () => {
    expect(needsPlanLink(acc({ propFirmPlanId: 'apex-eod-50k' }))).toBe(false);
    expect(needsPlanLink(acc({ status: 'ARCHIVED' }))).toBe(false);
    expect(needsPlanLink(acc({ type: 'PERSONAL' }))).toBe(false);
    expect(needsPlanLink(acc({ planLinkChoice: 'PERSONAL' }))).toBe(false);
    expect(needsPlanLink(acc({ planLinkChoice: 'UNLISTED' }))).toBe(false);
  });
});
