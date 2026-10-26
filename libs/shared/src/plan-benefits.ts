import { ACCOUNT_LIMITS } from './pricing';

/**
 * Avantages des plans : source UNIQUE des listes courtes (fenêtre des offres de l'app, cartes de
 * tarifs de la landing `/` et `/prop-firm`, e-mail de bienvenue Premium). Chaque ligne correspond à
 * une fonction LIVRÉE, et chaque ligne Premium à une fonction RÉSERVÉE au Premium (gating vérifié,
 * cf. `.claude/agents/plans.md`). Aucune promesse de résultat. Validée par Greg le 2026-10-19.
 *
 * `id` sert aux écrans qui doivent masquer une ligne (la landing cache `accounts` tant que
 * `FEATURES.multiAccounts` est éteint).
 */
export interface PlanBenefit {
  id: string;
  text: string;
}

export const PLAN_BENEFITS: { free: readonly PlanBenefit[]; premium: readonly PlanBenefit[] } = {
  free: [
    { id: 'tradovate_sync', text: 'Synchro Tradovate automatique, en lecture seule' },
    {
      id: 'prop_firm_live',
      text: `${ACCOUNT_LIMITS.free} compte avec les règles de sa prop firm, suivi en direct pendant la séance`,
    },
    { id: 'journal', text: 'Journal et trades illimités, historique complet' },
    { id: 'session', text: 'Préparation et débrief de chaque séance' },
    { id: 'market', text: 'Calendrier éco, news et contexte marché' },
  ],
  // Alertes et anti-tilt : évalués sur la synchro Tradovate EN DIRECT, qui ne tourne que tant que
  // l'app est ouverte (canal /tradovate-live) ; rien sur une saisie manuelle, ni e-mail ni push.
  premium: [
    {
      id: 'loss_alerts',
      text: 'Alertes avant d’atteindre ta limite de perte, app ouverte ou en notification pendant ta séance (compte Tradovate connecté)',
    },
    {
      id: 'anti_tilt',
      text: 'Anti-tilt en direct, app ouverte ou en notification pendant ta séance (compte Tradovate connecté) : reprise de position après une perte, taille qui grossit, surtrading',
    },
    { id: 'accounts', text: 'Comptes illimités, chacun avec les règles de sa prop firm' },
    { id: 'weekly_debrief', text: 'Débrief de ta semaine rédigé par le coach IA' },
    { id: 'analytics', text: 'Analyses avancées : par setup, par heure, drawdown détaillé' },
    { id: 'ai_coach', text: 'Coach IA : insights, chat et récap du jour à 17\u00a0h\u00a030' },
  ],
};
