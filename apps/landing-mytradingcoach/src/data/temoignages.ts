/**
 * Temoignages affiches sur la landing. VIDE par defaut, et c'est voulu.
 *
 * La section « Construit avec les premiers traders » annoncait une preuve sociale et n'en
 * livrait aucune : ni citation, ni avatar, ni chiffre. Audit du 2026-09-28. Une section qui
 * promet des retours et montre un bouton dessert plus qu'elle ne sert, surtout placee juste
 * apres le prix, la ou l'hesitation culmine.
 *
 * Tant que cette liste est vide et que le compteur de traders est sous son seuil, la section
 * ne s'affiche pas du tout. Des qu'une citation REELLE y est ajoutee, elle apparait.
 *
 * Ne JAMAIS inventer de temoignage : un faux retour est un risque juridique (pratique
 * commerciale trompeuse) autant qu'une trahison des utilisateurs qui ont vraiment aide.
 * Demander l'accord de la personne, et n'afficher que ce qu'elle a accepte de voir publie.
 */
export interface Temoignage {
  /** Prenom ou pseudo, tel que la personne accepte d'etre citee. */
  nom: string;
  /** Ce qui rend la citation credible pour un lecteur trader : « scalper ICT, futures ». */
  profil: string;
  /** Ses mots, non reecrits. Une citation lissee se repere et ne convainc personne. */
  citation: string;
}

export const TEMOIGNAGES: Temoignage[] = [];
