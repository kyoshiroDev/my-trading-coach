import type { AccountStatus, AccountType, PlanLinkChoice } from '../contracts/enums';

/** Ce qu'il faut d'un compte pour savoir s'il reste à relier à son plan. */
export interface PlanLinkState {
  propFirmPlanId: string | null;
  status: AccountStatus;
  type: AccountType;
  planLinkChoice?: PlanLinkChoice | null;
}

/**
 * Compte « plan à renseigner » (#612) : bandeau dans Mes comptes, appel à l'action à la place des
 * jauges en Session live. Un compte prop firm sans plan, ou laissé à « Plus tard ». Jamais un
 * compte archivé, déclaré perso, ou dont la firm n'est pas au catalogue (rien à proposer).
 */
export function needsPlanLink(a: PlanLinkState): boolean {
  if (a.propFirmPlanId || a.status === 'ARCHIVED') return false;
  if (a.planLinkChoice === 'PERSONAL' || a.planLinkChoice === 'UNLISTED') return false;
  return a.planLinkChoice === 'LATER' || a.type === 'EVALUATION' || a.type === 'FUNDED';
}
