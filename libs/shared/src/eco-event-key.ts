/**
 * Normalise une clé event `name:currency` en retirant le suffixe de période
 * variable ("(May)", "(Q1 2026)"…). DOIT rester identique au backend
 * (eco-calendar.service.ts → normalizeEventKey) pour que le matching front/back
 * soit cohérent : un favori épinglé en mai matche le même event en juin.
 */
export function normalizeEventKey(key: string): string {
  const colonIdx = key.lastIndexOf(':');
  if (colonIdx === -1) return key;
  const name = key.substring(0, colonIdx).replace(/\s*\([^)]*\)\s*$/, '').trim();
  const currency = key.substring(colonIdx + 1);
  return `${name}:${currency}`;
}

/** Helper : clé normalisée d'un event. */
export function eventKey(e: { name: string; currency: string }): string {
  return normalizeEventKey(`${e.name}:${e.currency}`);
}
