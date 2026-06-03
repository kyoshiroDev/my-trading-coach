import { describe, it, expect } from 'vitest';

// Smoke test : garantit que la cible `test` d'admin-mytradingcoach a au moins
// une suite (l'executor @angular/build:unit-test échoue sinon — "No tests found").
// À remplacer par de vrais tests quand des specs admin seront ajoutés.
describe('admin-mytradingcoach — smoke', () => {
  it('la suite de tests se charge', () => {
    expect(1 + 1).toBe(2);
  });
});