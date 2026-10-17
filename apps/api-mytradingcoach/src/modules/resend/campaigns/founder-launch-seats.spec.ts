import { describe, it, expect } from 'vitest';
import { founderLaunchTemplate } from './campaign-templates';

// Compteur de places de l'e-mail de lancement : libellé partagé founderSeatsLabel.
describe('founderLaunchTemplate — compteur de places', () => {
  const ctx = { userName: 'Greg', appUrl: 'https://app.mytradingcoach.app', unsubUrl: 'https://x/unsub' };

  it('aucune place prise : « 200 places disponibles », jamais « Il reste 200 places sur 200 »', () => {
    const c = founderLaunchTemplate({ ...ctx, seatsLeft: 200 });
    expect(c.html).toContain('<b>200 places disponibles</b>. Quand elles sont parties');
    expect(c.text).toContain('200 places disponibles. Quand elles sont parties');
    expect(c.html + c.text).not.toMatch(/Il reste|Plus que 200/);
  });

  it('places prises : « Plus que 154 places sur 200 », une seule : « Plus qu’une place sur 200 »', () => {
    expect(founderLaunchTemplate({ ...ctx, seatsLeft: 154 }).text).toContain('Plus que 154 places sur 200.');
    expect(founderLaunchTemplate({ ...ctx, seatsLeft: 1 }).text).toContain("Plus qu'une place sur 200.");
  });
});
