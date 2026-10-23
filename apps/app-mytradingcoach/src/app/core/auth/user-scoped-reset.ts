import { Injectable } from '@angular/core';

/**
 * Stores propres à un utilisateur, à vider au logout (anti-fuite inter-comptes : un login sur un
 * AUTRE compte dans le même onglet héritait des comptes/setups/trades du précédent).
 *
 * Chaque store s'inscrit à sa création ; `AuthService` ne les importe pas. Sinon ils partaient
 * tous dans le bundle initial avec leurs API, alors que /register n'en utilise aucun (#692).
 * Un store jamais créé n'a rien à vider.
 */
@Injectable({ providedIn: 'root' })
export class UserScopedReset {
  private readonly resets: (() => void)[] = [];

  register(reset: () => void): void {
    this.resets.push(reset);
  }

  resetAll(): void {
    for (const reset of this.resets) reset();
  }
}
