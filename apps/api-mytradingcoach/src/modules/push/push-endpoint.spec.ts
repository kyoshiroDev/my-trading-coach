import { describe, it, expect } from 'vitest';
import { isAllowedPushEndpoint, pushEndpointCheck } from './push-endpoint';

/** Revue #717, I1 : seuls les services push des navigateurs sont contactés. */

describe('pushEndpointCheck', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc:APA91b',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
    'https://web.push.apple.com/QGxyz',
    'https://wns2-par02p.notify.windows.com/w/?token=x',
    'https://FCM.googleapis.com:443/fcm/send/x',
  ])('accepté : %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    ['adresse interne', 'https://127.0.0.1/x'],
    ['métadonnées du cloud', 'https://169.254.169.254/latest/meta-data'],
    ['réseau privé', 'https://10.0.0.5/x'],
    ['IPv6 locale', 'https://[::1]/x'],
    ['IP en notation décimale', 'https://2130706433/x'],
    ['nom interne', 'https://postgres.internal/x'],
    ['domaine qui résout en local', 'https://127.0.0.1.nip.io/x'],
    ['service connu en préfixe', 'https://fcm.googleapis.com.evil.com/x'],
    ['faux sous-domaine Apple', 'https://evilpush.apple.com/x'],
    ['domaine Apple nu', 'https://push.apple.com/x'],
    ['point final', 'https://fcm.googleapis.com./x'],
    ['identifiants intégrés', 'https://user:pw@fcm.googleapis.com/x'],
    ['port non standard', 'https://fcm.googleapis.com:6379/x'],
    ['HTTP', 'http://fcm.googleapis.com/x'],
    ['illisible', 'pas une url'],
  ])('refusé (%s) : %s', (_, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });

  it('le refus donne l’hôte et la raison, jamais le chemin (qui contient le jeton)', () => {
    const r = pushEndpointCheck('https://169.254.169.254/secret-token');
    expect(r).toEqual({ ok: false, reason: 'service push inconnu', host: '169.254.169.254' });
    expect(JSON.stringify(r)).not.toContain('secret-token');
  });
});
