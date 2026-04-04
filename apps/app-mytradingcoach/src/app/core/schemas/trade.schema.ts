import { z } from 'zod';

export const CreateTradeSchema = z.object({
  asset: z.string().min(1, 'Asset requis'),
  side: z.enum(['LONG', 'SHORT']),
  entry: z.number().positive('Entry doit être positif'),
  exit: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  pnl: z.number().optional(),
  riskReward: z.number().optional(),
  emotion: z.enum(['CONFIDENT', 'STRESSED', 'REVENGE', 'FEAR', 'FOCUSED', 'NEUTRAL']),
  setup: z.enum(['BREAKOUT', 'PULLBACK', 'RANGE', 'REVERSAL', 'SCALPING', 'NEWS']),
  session: z.enum(['LONDON', 'NEW_YORK', 'ASIAN', 'PRE_MARKET', 'OVERLAP']),
  timeframe: z.string().min(1),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  tradedAt: z.string().optional(),
});

export type CreateTradeDtoValidated = z.infer<typeof CreateTradeSchema>;
