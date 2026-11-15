// @vitest-environment node
/**
 * #1020 (trouvé pendant #999) : « Modifier » l'e-mail envoyait `{ email }` à `PATCH /users/me`, dont le
 * DTO n'accepte que `name` → 400 à chaque essai. Changer d'adresse demande une confirmation sur la
 * nouvelle adresse (fonctionnalité à part) : l'e-mail est affiché en lecture seule.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(__dirname, 'profile.component.html'), 'utf-8');
const ts = readFileSync(join(__dirname, 'profile.component.ts'), 'utf-8');
const ligne = html.slice(html.indexOf('data-testid="profile-email"'), html.indexOf('<!-- Nom -->'));

describe('Profil : e-mail en lecture seule (#1020)', () => {
  it('l’adresse reste affichée', () => {
    expect(ligne).toContain('{{ userStore.user()?.email }}');
  });

  it('plus de bouton « Modifier » ni de champ de saisie sur la ligne e-mail', () => {
    expect(ligne).not.toContain('settings-edit-btn');
    expect(ligne).not.toContain('<input');
  });

  it('plus aucun envoi d’e-mail vers PATCH /users/me', () => {
    expect(ts).not.toMatch(/saveEmail|startEditEmail|saveUserField\(\{\s*email/);
  });
});
