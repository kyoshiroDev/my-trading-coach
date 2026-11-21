/**
 * Texte saisi par un utilisateur ou produit par l'IA, inséré dans du HTML (e-mails, PDF, aperçu de
 * campagne) : jamais interprété comme du balisage (S1 #1063). Les cinq caractères sensibles ; une
 * valeur absente donne une chaîne vide. Seule implémentation de l'API (#1073).
 *
 * Jamais pour un objet d'e-mail : c'est du texte brut, l'échapper y afficherait « &amp; ».
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
