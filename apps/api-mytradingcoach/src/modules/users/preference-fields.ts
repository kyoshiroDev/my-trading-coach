import type { UpdatePreferencesDto } from './dto/update-preferences.dto';

/**
 * Préférences écrites par `updatePreferences` (#1267) : recopiées une par une, jamais le DTO entier.
 * Un champ ajouté à `UpdatePreferencesDto` sans être listé ici (ou dans `IgnoredPreferenceField`)
 * casse le typecheck : on décide champ par champ ce qui part en base.
 */
export const PREFERENCE_FIELDS = [
  'startingCapital',
  'notificationsEmail',
  'debriefAutomatic',
  'marketingConsent',
  'tradingStyle',
  'tradingStrategy',
  'tradingSessions',
  'tradesPerDayMin',
  'tradesPerDayMax',
  'strategyDescription',
  'newsShieldMinutes',
] as const satisfies readonly (keyof UpdatePreferencesDto)[];
export type PreferenceField = (typeof PREFERENCE_FIELDS)[number];
/** Champs du DTO acceptés mais jamais écrits (devise globale retirée). */
type IgnoredPreferenceField = 'currency';
const preferenceFieldsComplete: Exclude<keyof UpdatePreferencesDto, PreferenceField | IgnoredPreferenceField> extends never
  ? true
  : never = true;
void preferenceFieldsComplete;
