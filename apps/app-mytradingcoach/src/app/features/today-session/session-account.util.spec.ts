import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionAccountChoiceRequired, sessionAccountValue } from './session-account.util';

/**
 * « Choisis un compte pour lancer la session » (#880) : jamais pendant une séance active, quel que
 * soit le compte de l'en-tête. Horloge figée sur chaque heure de la démo (séance du jour créée par le
 * seed, trades du jour après 09:45, heures de New York après 16:15, journée qui bascule à minuit).
 */

// Heures de Paris (UTC+1 en novembre) où la démo a été vérifiée.
const HOURS: Record<string, string> = {
  'lundi 10:30 (séance de Londres)': '2026-11-09T09:30:00Z',
  'lundi 22:00 (après 16:15)': '2026-11-09T21:00:00Z',
  'dimanche 15:00 (marché fermé)': '2026-11-08T14:00:00Z',
  'lundi 01:30 (avant le reseed de 03:20)': '2026-11-09T00:30:00Z',
};

const DEMO_ACCOUNT = 'apex-50k-eval-2';

afterEach(() => vi.useRealTimers());

for (const [label, at] of Object.entries(HOURS)) {
  describe(`démo, ${label}`, () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(at));
    });

    // Séance du jour du seed : active, ouverte peu avant « maintenant », rattachée au compte Apex.
    const activeSession = () => ({
      status: 'ACTIVE',
      accountId: DEMO_ACCOUNT,
      startedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    });

    it('séance active et « Tous les comptes » dans l’en-tête : aucun message, la liste montre le compte de la séance', () => {
      const session = activeSession();
      expect(sessionAccountChoiceRequired({ activeAccountCount: 3, selectedAccountParam: undefined, session })).toBe(false);
      expect(sessionAccountValue('all', session)).toBe(DEMO_ACCOUNT);
    });
  });
}

describe('vrai compte', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T14:00:00Z'));
  });

  it('aucune séance et « Tous les comptes » : le message s’affiche (un compte précis est requis)', () => {
    expect(sessionAccountChoiceRequired({ activeAccountCount: 2, selectedAccountParam: undefined, session: null })).toBe(true);
    expect(sessionAccountValue('all', null)).toBe('all');
  });

  it('aucune séance et un compte choisi : pas de message', () => {
    expect(sessionAccountChoiceRequired({ activeAccountCount: 2, selectedAccountParam: 'a1', session: null })).toBe(false);
  });

  it('séance lancée sur A puis en-tête passé sur « Tous » : pas de message, la liste reste sur A', () => {
    const session = { status: 'ACTIVE', accountId: 'a1' };
    expect(sessionAccountChoiceRequired({ activeAccountCount: 2, selectedAccountParam: undefined, session })).toBe(false);
    expect(sessionAccountValue('all', session)).toBe('a1');
    expect(sessionAccountValue('a2', session)).toBe('a1');
  });

  it('séance clôturée : on peut en relancer une, le choix du compte redevient obligatoire', () => {
    const session = { status: 'CLOSED', accountId: 'a1' };
    expect(sessionAccountChoiceRequired({ activeAccountCount: 2, selectedAccountParam: undefined, session })).toBe(true);
    expect(sessionAccountValue('all', session)).toBe('all');
  });

  it('aucun compte : jamais de message (session sans compte possible)', () => {
    expect(sessionAccountChoiceRequired({ activeAccountCount: 0, selectedAccountParam: undefined, session: null })).toBe(false);
  });

  it('séance active sans compte (ancienne séance) : pas de message, la liste garde le choix de l’en-tête', () => {
    const session = { status: 'ACTIVE', accountId: null };
    expect(sessionAccountChoiceRequired({ activeAccountCount: 2, selectedAccountParam: undefined, session })).toBe(false);
    expect(sessionAccountValue('all', session)).toBe('all');
  });
});
