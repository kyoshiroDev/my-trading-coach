import { assetCurrencies } from '../eco-calendar/eco-calendar.briefing';
import type { BehaviorAlertDraft } from './behavior-detectors';

/**
 * Bouclier annonces (#670), calcul PUR : une position ouverte, ou qui s'ouvre, moins de X minutes
 * avant une annonce à fort impact d'une devise de l'actif. Message factuel, sans conseil (AMF).
 * Partagé par le détecteur à l'entrée (`D1_NEWS_WINDOW`) et le passage « avant l'annonce ».
 */

/** Seuil par défaut (décision du 2026-11-23) et bornes du réglage du Profil. 0 = bouclier coupé. */
export const NEWS_SHIELD_DEFAULT_MINUTES = 5;
export const NEWS_SHIELD_MAX_MINUTES = 30;

/** Annonce forte à venir, heure déjà convertie en UTC (`parisWallTimeToUtc`). */
export interface NewsEvent {
  at: Date;
  /** Libellé affiché : `nameFr`, sinon le nom d'origine, sans suffixe de période. */
  label: string;
  currency: string;
}

/** Bouclier coupé interrupteur général : `NEWS_SHIELD_ENABLED=true` seulement (éteint par défaut). */
export const newsShieldEnabled = () => process.env['NEWS_SHIELD_ENABLED'] === 'true';

/** Fenêtre effective du trader : null = défaut, 0 = coupé, sinon bornée à 1..30. */
export function newsShieldMinutes(pref: number | null | undefined): number {
  if (pref == null) return NEWS_SHIELD_DEFAULT_MINUTES;
  if (pref <= 0) return 0;
  return Math.min(NEWS_SHIELD_MAX_MINUTES, Math.round(pref));
}

/** Clé d'anti-spam d'un créneau d'annonce : une alerte par compte et par annonce. */
export const newsSlotKey = (at: Date, currencies: string[]) => `${at.toISOString()}:${[...currencies].sort().join('+')}`;

const joinLabels = (labels: string[]) =>
  labels.length <= 1 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} et ${labels[labels.length - 1]}`;

/**
 * Alerte du bouclier pour un actif à l'instant `at`, ou null. Seules les annonces du premier créneau
 * à venir (même heure) dans la fenêtre sont retenues, celles des devises de l'actif.
 */
export function newsShieldDraft(at: Date, asset: string, events: NewsEvent[], minutes: number): BehaviorAlertDraft | null {
  if (minutes <= 0) return null;
  const ccys = assetCurrencies(asset);
  if (!ccys.length) return null;
  const horizon = at.getTime() + minutes * 60_000;
  const upcoming = events
    .filter((e) => ccys.includes(e.currency) && e.at.getTime() > at.getTime() && e.at.getTime() <= horizon)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (!upcoming.length) return null;
  const slot = upcoming[0].at;
  const same = upcoming.filter((e) => e.at.getTime() === slot.getTime());
  const labels = [...new Set(same.map((e) => e.label))];
  const inMin = Math.max(1, Math.round((slot.getTime() - at.getTime()) / 60_000));
  return {
    type: 'D1_NEWS_WINDOW',
    severity: 'high',
    message: `${joinLabels(labels)} dans ${inMin} min, position ouverte sur ${asset}.`,
    context: {
      slot: slot.toISOString(),
      slotKey: newsSlotKey(slot, [...new Set(same.map((e) => e.currency))]),
      events: same.map((e) => ({ label: e.label, currency: e.currency })),
      minutesBefore: inMin,
      windowMinutes: minutes,
    },
  };
}

/** Libellé d'une annonce : traduction si connue, nom d'origine sinon, sans « (Sep) » final. */
export function newsLabel(e: { name: string; nameFr?: string | null }): string {
  return (e.nameFr || e.name).replace(/\s*\([^)]*\)\s*$/, '').trim();
}
