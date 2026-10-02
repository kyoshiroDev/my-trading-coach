import { z } from 'zod';

/**
 * Format d'un fichier du catalogue prop firm (`libs/shared/src/prop-firm-rules/<firm>.json`).
 *
 * Calque Zod de `schema.json` (JSON Schema 2020-12, validé en CI par ajv) : les deux doivent
 * rester alignés. Sert à deux endroits :
 *  - la synchro au démarrage, qui refuse d'écrire en base un catalogue invalide ;
 *  - la relecture des colonnes Json de `PropFirmPlan` (`phases`, `price`, `configuration`).
 *
 * Objets stricts, comme `additionalProperties: false` côté JSON Schema : un champ inconnu est
 * une erreur, pas une donnée qu'on laisserait passer en silence.
 */

const slug = z.string().regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/);
const money = z.number().min(0);
const nullableMoney = money.nullable();
const pct = z.number().gt(0).max(1);
const timeOfDay = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9] [A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/);
const nullableText = z.string().nullable();
const positiveInt = z.number().int().min(1);

const tierBounds = { min_profit: z.number(), max_profit: z.number().nullable() };

const dailyLossLimitSchema = z.strictObject({
  amount: z.number().gt(0).nullable(),
  basis: z.enum(['balance', 'equity']).nullable(),
  resets_at: timeOfDay.nullable(),
  breach: z.enum(['account_failed', 'trading_paused_for_day']),
  tiers: z.array(z.strictObject({ ...tierBounds, amount: z.number().gt(0) })).min(1).nullable().optional(),
  scaling_rule: nullableText.optional(),
  notes: nullableText.optional(),
});

const maxDrawdownSchema = z.strictObject({
  amount: z.number().gt(0),
  type: z.enum(['static', 'trailing_eod', 'trailing_intraday']),
  trails_on: z.enum(['balance', 'equity']).nullable(),
  locks_at: nullableMoney,
  locked_floor: nullableMoney.optional(),
  enforced_on: z.enum(['equity_realtime', 'balance_realtime', 'eod_balance']).nullable().optional(),
  platform_overrides: z
    .record(slug, z.strictObject({ locks_at: nullableMoney, locked_floor: nullableMoney, notes: nullableText.optional() }))
    .nullable()
    .optional(),
  basis_notes: nullableText,
});

const consistencySchema = z.strictObject({
  max_single_day_pct: pct,
  applies_to: z.enum(['profit_target', 'payout']),
  notes: nullableText,
});

const maxContractsSchema = z.strictObject({
  minis: positiveInt.nullable(),
  micros: positiveInt.nullable(),
  scaling: z.boolean(),
  tiers: z.array(z.strictObject({ ...tierBounds, minis: positiveInt, micros: positiveInt })).min(1).nullable().optional(),
  notes: nullableText,
});

const timeRulesSchema = z.strictObject({
  must_close_by: timeOfDay.nullable(),
  news_trading_allowed: z.boolean().nullable(),
  overnight_allowed: z.boolean().nullable(),
  notes: nullableText.optional(),
});

const payoutSchema = z.strictObject({
  min_days: positiveInt.nullable(),
  min_daily_profit: nullableMoney.optional(),
  min_cycle_profit: nullableMoney.optional(),
  min_cycle_profit_schedule: z.array(money).min(1).nullable().optional(),
  split_pct: pct.nullable(),
  // Partage qui change au-delà d'un cumul payé (Apex Legacy : 100 % jusqu'à 25 000 $, puis 90 %).
  split_after: z.strictObject({ paid_out_over: money, split_pct: pct }).nullable().optional(),
  min_amount: nullableMoney,
  max_amount: nullableMoney,
  // null dans le tableau = pas de plafond pour ce payout (Apex Legacy : libre à partir du 6e).
  max_amount_schedule: z.array(nullableMoney).min(1).nullable().optional(),
  max_payouts: positiveInt.nullable().optional(),
  safety_net_balance: nullableMoney.optional(),
  notes: nullableText,
});

export const propFirmPhaseSchema = z.strictObject({
  phase: z.enum(['evaluation', 'funded', 'direct']),
  profit_target: z.number().gt(0).nullable(),
  daily_loss_limit: dailyLossLimitSchema.nullable(),
  max_drawdown: maxDrawdownSchema,
  consistency: consistencySchema.nullable(),
  min_trading_days: positiveInt.nullable(),
  max_duration_days: positiveInt.nullable().optional(),
  max_contracts: maxContractsSchema,
  time_rules: timeRulesSchema,
  payout: payoutSchema.nullable(),
});

export const propFirmPriceSchema = z.strictObject({
  amount: nullableMoney,
  billing: z.enum(['one_time', 'monthly']),
  activation_fee: nullableMoney.optional(),
  notes: nullableText,
});

export const propFirmConfigurationSchema = z.strictObject({
  daily_loss_limit: z.boolean().nullable(),
  eval_drawdown: z.enum(['eod', 'intraday']).nullable(),
});

export const propFirmPlanSchema = z.strictObject({
  id: slug,
  plan_name: z.string().min(1),
  account_size: z.number().gt(0),
  currency: z.string().regex(/^[A-Z]{3,4}$/),
  availability: z.enum(['public', 'invite_only']).optional(),
  configuration: propFirmConfigurationSchema.nullable().optional(),
  price: propFirmPriceSchema,
  phases: z.array(propFirmPhaseSchema).min(1),
  source_urls: z.array(z.url()).min(1),
  needs_review: z.boolean(),
  notes: nullableText,
});

export const propFirmFileSchema = z.strictObject({
  firm: z.strictObject({
    id: slug,
    name: z.string().min(1),
    website: z.url(),
    help_center: z.url().nullable().optional(),
    platforms: z.array(slug).min(1),
  }),
  verified_at: z.iso.date(),
  plans: z.array(propFirmPlanSchema).min(1),
});

export type PropFirmFile = z.infer<typeof propFirmFileSchema>;
export type PropFirmPlanRules = z.infer<typeof propFirmPlanSchema>;
export type PropFirmPhase = z.infer<typeof propFirmPhaseSchema>;
