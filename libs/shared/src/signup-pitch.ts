import { PROP_FIRM_COUNT } from './prop-firm-rules/catalog-count';

/**
 * Points de la colonne de présentation de `/register` et `/login` (≥ 1024 px). Même règle que
 * `PLAN_BENEFITS` : une fonction livrée par ligne, `premium` seulement sur une fonction réservée au
 * Premium, et alors `benefitId` = la ligne Premium correspondante (vérifié par le spec).
 * Module à part : seule la colonne (chargée à la demande) l'importe, alors que `PLAN_BENEFITS`
 * est dans le bundle initial de l'app.
 */
export interface PitchPoint {
  text: string;
  premium?: boolean;
  benefitId?: string;
}

export const SIGNUP_PITCH_POINTS: readonly PitchPoint[] = [
  { text: 'Tes trades arrivent tout seuls, en lecture seule' },
  { text: `Ta marge avant la limite, avec les règles de ${PROP_FIRM_COUNT} prop firms` },
  { text: 'Ton journal complet : setups, émotions, notes, statistiques' },
  { text: 'Prépare ta séance, puis débriefe-la juste après' },
  {
    text: 'Une alerte quand tu reprends une position juste après une perte, app ouverte ou en notification (compte Tradovate connecté)',
    premium: true,
    benefitId: 'anti_tilt',
  },
  { text: 'Le coach IA rédige ton débrief de la semaine', premium: true, benefitId: 'weekly_debrief' },
];
