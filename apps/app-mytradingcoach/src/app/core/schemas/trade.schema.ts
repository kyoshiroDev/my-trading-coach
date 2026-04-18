import { z } from 'zod';

// ngModel sur <input type="number"> produit null quand le champ est vidé.
// On normalise null → undefined pour que .optional() accepte les champs vides.
const nullToUndef = (v: unknown) => (v == null ? undefined : v);

const optPositive = z.preprocess(nullToUndef, z.number().positive().optional());
const optNumber   = z.preprocess(nullToUndef, z.number().optional());

export const CreateTradeSchema = z.object({
  asset: z.string().min(1, 'Asset requis'),
  side: z.enum(['LONG', 'SHORT']),
  entry: z.preprocess(nullToUndef, z.number().positive('Entry requis (> 0)')),
  exit: optPositive,
  stopLoss: optPositive,
  takeProfit: optPositive,
  pnl: optNumber,
  riskReward: optNumber,
  emotion: z.enum(['CONFIDENT', 'STRESSED', 'REVENGE', 'FEAR', 'FOCUSED', 'NEUTRAL']),
  setup: z.enum(['BREAKOUT', 'PULLBACK', 'RANGE', 'REVERSAL', 'SCALPING', 'NEWS']),
  session: z.enum(['LONDON', 'NEW_YORK', 'ASIAN', 'PRE_MARKET', 'OVERLAP']),
  timeframe: z.string().min(1),
  notes: z.preprocess(nullToUndef, z.string().optional()),
  tags: z.array(z.string()).optional(),
  tradedAt: z.string().optional(),
});

export type CreateTradeDtoValidated = z.infer<typeof CreateTradeSchema>;
