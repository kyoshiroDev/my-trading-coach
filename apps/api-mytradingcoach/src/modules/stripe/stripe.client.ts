import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/** Jeton d'injection du client Stripe, partagé par tous les services du module. */
export const STRIPE_CLIENT = Symbol('STRIPE_CLIENT');

export function createStripeClient(secretKey: string): Stripe {
  return new Stripe(
    secretKey,
    // Version d'API épinglée (comportement testé). Cast car le type du SDK
    // Stripe 22.2 pointe vers une version plus récente : runtime inchangé.
    { apiVersion: '2024-06-20' as Stripe.LatestApiVersion },
  );
}

export const stripeClientProvider: Provider = {
  provide: STRIPE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    createStripeClient(config.getOrThrow<string>('STRIPE_SECRET_KEY')),
};
