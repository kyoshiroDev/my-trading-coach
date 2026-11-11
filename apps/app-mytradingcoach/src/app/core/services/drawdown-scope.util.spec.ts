import { describe, expect, it } from 'vitest';
import { DRAWDOWN_PICK_ACCOUNT, drawdownScopeLabel, isMultiAccountView } from './drawdown-scope.util';

const ACCOUNTS = [{ id: 'a', label: 'Lucid A' }, { id: 'b', label: 'Lucid B' }];

describe('drawdownScopeLabel (PROMPT-drawdown-max-par-compte)', () => {
  it('pire drawdown sur un compte connu → « sur le compte X »', () => {
    expect(drawdownScopeLabel('b', -400, ACCOUNTS)).toBe('sur le compte Lucid B');
  });
  it('pire drawdown sur les trades sans compte', () => {
    expect(drawdownScopeLabel(null, -120, ACCOUNTS)).toBe('sur les trades sans compte');
  });
  it('rien à dire : aucune baisse, ancien cache sans le champ, compte introuvable', () => {
    expect(drawdownScopeLabel(null, 0, ACCOUNTS)).toBeNull();
    expect(drawdownScopeLabel(undefined, -400, ACCOUNTS)).toBeNull();
    expect(drawdownScopeLabel('z', -400, ACCOUNTS)).toBeNull();
    expect(drawdownScopeLabel('a', -400, [])).toBeNull();
  });
});

describe('isMultiAccountView', () => {
  it('« Tous les comptes » avec plusieurs comptes → oui', () => expect(isMultiAccountView('all', 2)).toBe(true));
  it('« Tous les comptes » avec un seul compte, aucun compte, ou un compte choisi → non', () => {
    expect(isMultiAccountView('all', 1)).toBe(false);
    expect(isMultiAccountView('all', 0)).toBe(false);
    expect(isMultiAccountView('a', 3)).toBe(false);
  });
  it('texte à la place de la courbe', () => expect(DRAWDOWN_PICK_ACCOUNT).toBe('Choisis un compte pour voir la courbe'));
});
