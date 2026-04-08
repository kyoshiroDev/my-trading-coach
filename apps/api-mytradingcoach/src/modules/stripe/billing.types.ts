import Stripe from 'stripe';
import { Plan } from '@prisma/client';

// ── Job BullMQ ────────────────────────────────────────────────────────────────

/** Payload du job BullMQ pour le traitement async des webhooks Stripe */
export interface WebhookJobPayload {
  event: Stripe.Event;
}

// ── Réponse API ───────────────────────────────────────────────────────────────

/** Statut de facturation retourné par GET /api/billing/status */
export interface BillingStatusResponse {
  plan: Plan;
  subscriptionStatus: Stripe.Subscription['status'] | null;
  currentPeriodEnd: string | null; // ISO 8601
  trialUsed: boolean;
  trialEndsAt: string | null; // ISO 8601 — présent seulement en phase trial
}

// ── Cache ─────────────────────────────────────────────────────────────────────

/** Structure cachée dans Redis */
export interface CachedBillingStatus {
  plan: Plan;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  trialUsed: boolean;
  trialEndsAt: string | null;
}
