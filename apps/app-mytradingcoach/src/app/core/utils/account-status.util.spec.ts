import { describe, expect, it } from 'vitest';
import {
  countsInAggregate,
  excludedAccountsLine,
  isInactiveStatus,
  statusBadgeClass,
  statusLabel,
} from './account-status.util';

describe('countsInAggregate (règle des chiffres « tous les comptes »)', () => {
  it('actif et validé comptés, échoué et archivé exclus par défaut', () => {
    expect(countsInAggregate('ACTIVE')).toBe(true);
    expect(countsInAggregate('PASSED')).toBe(true);
    expect(countsInAggregate('FAILED')).toBe(false);
    expect(countsInAggregate('ARCHIVED')).toBe(false);
  });

  it('includeInactive réintègre tout', () => {
    expect(countsInAggregate('FAILED', true)).toBe(true);
    expect(countsInAggregate('ARCHIVED', true)).toBe(true);
  });

  it('isInactiveStatus : seulement échoué et archivé', () => {
    expect(['ACTIVE', 'PASSED', 'FAILED', 'ARCHIVED'].map(isInactiveStatus)).toEqual([false, false, true, true]);
  });
});

describe('badges d\'état', () => {
  it('libellés de la maquette, une classe par statut', () => {
    expect(['ACTIVE', 'PASSED', 'FAILED', 'ARCHIVED'].map(statusLabel)).toEqual(['Actif', 'Validé', 'Échoué', 'Archivé']);
    expect(['ACTIVE', 'PASSED', 'FAILED', 'ARCHIVED'].map(statusBadgeClass)).toEqual([
      'is-active', 'is-passed', 'is-failed', 'is-archived',
    ]);
  });
});

describe('excludedAccountsLine', () => {
  it('texte de la maquette', () => {
    expect(excludedAccountsLine({ failed: 1, archived: 1 })).toBe('2 comptes exclus des chiffres : 1 échoué, 1 archivé.');
  });

  it('accords au singulier et au pluriel, parties absentes omises', () => {
    expect(excludedAccountsLine({ failed: 1, archived: 0 })).toBe('1 compte exclu des chiffres : 1 échoué.');
    expect(excludedAccountsLine({ failed: 0, archived: 3 })).toBe('3 comptes exclus des chiffres : 3 archivés.');
    expect(excludedAccountsLine({ failed: 2, archived: 1 })).toBe('3 comptes exclus des chiffres : 2 échoués, 1 archivé.');
  });

  it('aucun compte exclu → pas de ligne', () => {
    expect(excludedAccountsLine({ failed: 0, archived: 0 })).toBeNull();
  });
});
