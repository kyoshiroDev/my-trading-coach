import { Body, Controller, Get, Headers, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly config: ConfigService,
  ) {}

  // POST /api/billing/checkout — JWT requis (guard global)
  @Post('checkout')
  async checkout(
    @CurrentUser() user: { id: string; email: string },
    @Body('plan') plan: 'monthly' | 'yearly',
  ) {
    const priceId =
      plan === 'yearly'
        ? this.config.get<string>('STRIPE_PRICE_YEARLY')!
        : this.config.get<string>('STRIPE_PRICE_MONTHLY')!;

    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:4200';

    return this.billing.createCheckoutSession(user.id, user.email, priceId, frontendUrl);
  }

  // GET /api/billing/portal — JWT requis (guard global)
  @Get('portal')
  async portal(@CurrentUser() user: { id: string }) {
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:4200';
    return this.billing.createPortalSession(user.id, frontendUrl);
  }

  // POST /api/billing/webhook — PUBLIC (Stripe appelle directement, pas de JWT)
  @Public()
  @Post('webhook')
  async webhook(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Req() req: any,
    @Headers('stripe-signature') signature: string,
  ) {
    return this.billing.handleWebhook(req.rawBody!, signature);
  }
}
