import { frontendRedirectUrl } from './tradovate-connection.view';

/** URL de retour vers l'app : le nombre de comptes écartés n'y figure que s'il y en a. */
describe('frontendRedirectUrl — comptes écartés', () => {
  const base = 'https://app.test';

  it('comptes écartés → `excluded` transmis au front', () => {
    const url = new URL(
      frontendRedirectUrl(base, { status: 'select_account', accountId: 'a1', userId: 'u1', origin: 'settings', excluded: 1 }),
    );
    expect(url.pathname).toBe('/accounts');
    expect(url.searchParams.get('tradovate')).toBe('select_account');
    expect(url.searchParams.get('excluded')).toBe('1');
  });

  it('aucun compte écarté → pas de paramètre', () => {
    const url = new URL(
      frontendRedirectUrl(base, { status: 'select_account', accountId: 'a1', userId: 'u1', origin: 'wizard', excluded: 0 }),
    );
    expect(url.searchParams.has('excluded')).toBe(false);
    expect(url.searchParams.get('from')).toBe('wizard');
  });
});
