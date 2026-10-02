// Consentement cookies (RGPD) : partagé entre le bandeau et le chargeur GA4.
export type Consent = 'accepted' | 'refused';

const KEY = 'mtc_cookie_consent';
// Un choix est redemandé au bout de 6 mois (recommandation CNIL).
const MAX_AGE = 182 * 24 * 60 * 60 * 1000;

export function readConsent(): Consent | null {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (o && (o.value === 'accepted' || o.value === 'refused') && Date.now() - o.ts < MAX_AGE) {
      return o.value;
    }
  } catch {
    // localStorage indisponible (navigation privée stricte) : pas de choix connu.
  }
  return null;
}

export function saveConsent(value: Consent): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ value, ts: Date.now() }));
  } catch {
    // Choix non mémorisé : le bandeau reviendra à la prochaine page, sans traceur chargé.
  }
}
