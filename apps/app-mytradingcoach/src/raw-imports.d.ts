/** Imports `?raw` (Vite / vitest) : contenu brut d'un fichier, utilisé par les specs pour
 *  rendre le VRAI template d'un composant sans passer par `node:fs` (indisponible en jsdom
 *  sous l'exécuteur nx). */
declare module '*.html?raw' {
  const content: string;
  export default content;
}
