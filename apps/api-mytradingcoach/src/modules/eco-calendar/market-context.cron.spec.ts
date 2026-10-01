import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarketContextCron } from './market-context.cron';
import type { MarketDataService } from '../trades/market-data.service';
import type { EcoCalendarGateway } from './eco-calendar.gateway';

describe('MarketContextCron (SCA-B4-03)', () => {
  const ctx = { nq: { value: 1 } };
  const marketData = { getMarketContext: vi.fn() };
  const gateway = { connectedCount: vi.fn(), notifyMarketContext: vi.fn() };
  const cron = new MarketContextCron(marketData as unknown as MarketDataService, gateway as unknown as EcoCalendarGateway);

  beforeEach(() => {
    vi.clearAllMocks();
    marketData.getMarketContext.mockResolvedValue(ctx);
  });

  it('clients connectés → diffuse le contexte', async () => {
    gateway.connectedCount.mockResolvedValue(3);
    await cron.broadcast();
    expect(gateway.notifyMarketContext).toHaveBeenCalledWith(ctx);
  });

  it('personne de connecté → ni appel marché ni diffusion', async () => {
    gateway.connectedCount.mockResolvedValue(0);
    await cron.broadcast();
    expect(marketData.getMarketContext).not.toHaveBeenCalled();
    expect(gateway.notifyMarketContext).not.toHaveBeenCalled();
  });

  it('erreur (Redis, fournisseur) → avalée, le cron ne casse pas', async () => {
    gateway.connectedCount.mockRejectedValue(new Error('adapter timeout'));
    await expect(cron.broadcast()).resolves.toBeUndefined();
    expect(gateway.notifyMarketContext).not.toHaveBeenCalled();
  });
});
