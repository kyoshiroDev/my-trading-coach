import { Inject, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { STRIPE_CLIENT } from './stripe.client';

/** Customer Stripe d'un user : création sans doublon, lecture de son avoir. */
@Injectable()
export class StripeCustomerService {
  private readonly logger = new Logger(StripeCustomerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  /** Retourne le customer Stripe du user, en le retrouvant ou en le créant au besoin. */
  async ensureStripeCustomer(
    userId: string,
    userEmail: string,
  ): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (user.stripeCustomerId) return user.stripeCustomerId;

    // Chercher un customer existant sur Stripe (protection anti-doublons)
    const searchResult = await this.stripe.customers
      .search({ query: `metadata['userId']:"${userId}"`, limit: 1 })
      .catch(() => null);

    let customerId: string;

    if (searchResult?.data[0]) {
      customerId = searchResult.data[0].id;
      this.logger.debug(`Customer Stripe récupéré : ${customerId}`);
    } else {
      const customer = await this.stripe.customers.create(
        { email: userEmail, metadata: { userId } },
        { idempotencyKey: `customer-create-${userId}` },
      );
      customerId = customer.id;
      this.logger.log(`Customer Stripe créé : ${customerId} | user: ${userId}`);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId: customerId },
    });

    return customerId;
  }

  /** Crédit disponible (avoir) du parrain chez Stripe, en euros. Pour /referral/me. */
  async getCustomerBalanceCreditEur(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true },
    });
    if (!user?.stripeCustomerId) return 0;
    const customer = await this.stripe.customers
      .retrieve(user.stripeCustomerId)
      .catch(() => null);
    if (!customer || (customer as Stripe.DeletedCustomer).deleted) return 0;
    const balance = (customer as Stripe.Customer).balance ?? 0; // négatif = avoir
    return balance < 0 ? +(-balance / 100).toFixed(2) : 0;
  }
}
