import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LandingVisitDto } from './landing-visit.dto';

describe('LandingVisitDto', () => {
  it('ne garde que le chemin, sans query ni slash final', async () => {
    const dto = plainToInstance(LandingVisitDto, { path: '/blog/?utm_source=x#top', source: ' NinjaTrader.com ', entry: true });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.path).toBe('/blog');
    expect(dto.source).toBe('ninjatrader.com');
  });

  it('garde la racine telle quelle', async () => {
    const dto = plainToInstance(LandingVisitDto, { path: '/', entry: false });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.path).toBe('/');
  });

  it('refuse un chemin absolu externe ou trop long', async () => {
    expect(await validate(plainToInstance(LandingVisitDto, { path: 'https://evil.tld', entry: true }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(LandingVisitDto, { path: '/' + 'a'.repeat(200), entry: true }))).not.toHaveLength(0);
  });
});
