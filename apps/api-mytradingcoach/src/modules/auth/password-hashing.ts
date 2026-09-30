import * as argon2 from 'argon2';

/**
 * Paramètres argon2 de tous les mots de passe (audit scalabilité C2).
 *
 * Avant : les défauts de la lib, soit 64 Mio de mémoire par hash et 4 threads. Quelques
 * inscriptions ou connexions simultanées suffisaient à pousser le conteneur API à l'OOM.
 * Ici le minimum recommandé par l'OWASP pour argon2id (19 Mio, 2 passes, 1 thread).
 *
 * Les hashs existants restent vérifiables (leurs paramètres sont encodés dedans) ; ils sont
 * remplacés à la connexion suivante (`needsPasswordRehash`).
 */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export function needsPasswordRehash(hash: string): boolean {
  try {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  } catch {
    return false; // hash illisible : on ne touche à rien, la vérification l'a déjà traité
  }
}
