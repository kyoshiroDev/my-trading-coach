import { Injectable } from '@nestjs/common';
import { PrismaService } from '@api/prisma/prisma.service';
import { INSTRUMENTS } from './instruments.const';

export interface UserAssetItem {
  symbol: string;
  label: string;
  category: string;
  tradeCount: number;
  lastEntry: number | null;
  lastQty: number | null;
  isFavorite: boolean;
}

/** Actifs suivis par l'utilisateur (saisie rapide) : profil, sinon les plus tradés. */
@Injectable()
export class UserAssetsService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserAssets(userId: string): Promise<UserAssetItem[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tradingAssets: true, favoriteAsset: true },
    });
    const favoriteAsset = user?.favoriteAsset ?? null;
    const instrMap = new Map(INSTRUMENTS.map((i) => [i.symbol, i]));

    // Si l'user a configuré ses actifs → priorité au profil
    if (user?.tradingAssets?.length) {
      return user.tradingAssets.map((symbol) => {
        const instr = instrMap.get(symbol);
        return {
          symbol,
          label: instr?.label ?? symbol,
          category: instr?.category ?? 'CRYPTO',
          tradeCount: 0,
          lastEntry: null,
          lastQty: null,
          isFavorite: symbol === favoriteAsset,
        };
      });
    }

    // Fallback : top actifs sur les 100 derniers trades (tous mois confondus)
    const rows = await this.prisma.trade.findMany({
      where: { userId },
      select: { asset: true, entry: true, quantity: true, tradedAt: true },
      orderBy: { tradedAt: 'desc' },
      take: 100,
    });

    const map = new Map<string, { count: number; lastEntry: number | null; lastQty: number | null }>();
    for (const row of rows) {
      if (!map.has(row.asset)) {
        map.set(row.asset, { count: 0, lastEntry: row.entry, lastQty: row.quantity });
      }
      map.get(row.asset)!.count++;
    }

    const items: UserAssetItem[] = Array.from(map.entries()).map(([symbol, data]) => {
      const instr = instrMap.get(symbol);
      return {
        symbol,
        label: instr?.label ?? symbol,
        category: instr?.category ?? 'CRYPTO',
        tradeCount: data.count,
        lastEntry: data.lastEntry,
        lastQty: data.lastQty,
        isFavorite: symbol === favoriteAsset,
      };
    });

    items.sort((a, b) => b.tradeCount - a.tradeCount);

    if (favoriteAsset && !items.find((i) => i.symbol === favoriteAsset)) {
      const instr = instrMap.get(favoriteAsset);
      items.unshift({
        symbol: favoriteAsset,
        label: instr?.label ?? favoriteAsset,
        category: instr?.category ?? 'CRYPTO',
        tradeCount: 0,
        lastEntry: null,
        lastQty: null,
        isFavorite: true,
      });
    }

    return items.slice(0, 8);
  }

  async saveUserAssets(
    userId: string,
    assets: string[],
    favoriteAsset?: string | null,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        tradingAssets: assets,
        favoriteAsset: favoriteAsset ?? null,
      },
    });
  }

  async setFavoriteAsset(userId: string, asset: string | null): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { favoriteAsset: asset },
    });
  }
}
