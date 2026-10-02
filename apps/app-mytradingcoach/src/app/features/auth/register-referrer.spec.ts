import { referrerHost } from './register.component';

describe('referrerHost (plan B de la source d’acquisition)', () => {
  it('renvoie l’hôte externe sans www', () => {
    expect(referrerHost('https://www.ninjatrader.com/ecosystem/listing/x')).toBe('ninjatrader.com');
    expect(referrerHost('https://google.com/')).toBe('google.com');
  });

  it('ignore nos domaines, localhost et un referrer absent ou invalide', () => {
    expect(referrerHost('https://www.mytradingcoach.app/')).toBe('');
    expect(referrerHost('https://dev.app.mytradingcoach.app/login')).toBe('');
    expect(referrerHost('http://localhost:4329/')).toBe('');
    expect(referrerHost('')).toBe('');
  });
});
