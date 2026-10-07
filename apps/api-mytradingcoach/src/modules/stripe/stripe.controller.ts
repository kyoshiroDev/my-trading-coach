import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { ChangeIntervalDto } from './dto/change-interval.dto';
import { StripeBillingService } from './stripe-billing.service';
import { StripeWebhookService } from './stripe-webhook.service';

@Controller('billing')
export class StripeController {
  constructor(
    private readonly billing: StripeBillingService,
    private readonly webhooks: StripeWebhookService,
    private readonly config: ConfigService,
  ) {}

  // GET /api/billing/status : Plan, statut abo, trial, dates
  @Get('status')
  async status(@CurrentUser() user: { id: string }) {
    return this.billing.getBillingStatus(user.id);
  }

  // POST /api/billing/checkout : Crée une session Stripe Checkout
  @Post('checkout')
  async checkout(
    @CurrentUser() user: { id: string; email: string },
    @Body() dto: CreateCheckoutDto,
  ) {
    const priceId =
      ({
        premium_monthly: this.config.getOrThrow<string>('STRIPE_PREMIUM_PRICE_MONTHLY_V2'),
        premium_yearly:  this.config.getOrThrow<string>('STRIPE_PREMIUM_PRICE_YEARLY_V2'),
        founder_monthly: this.config.getOrThrow<string>('STRIPE_PREMIUM_PRICE_MONTHLY_FOUNDER'),
        founder_yearly:  this.config.getOrThrow<string>('STRIPE_PREMIUM_PRICE_YEARLY_FOUNDER'),
      })[dto.plan];

    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:4200';

    return this.billing.createCheckoutSession(
      user.id,
      user.email,
      priceId,
      frontendUrl,
      {
        offer: dto.plan.startsWith('founder') ? 'founder' : 'premium',
        interval: dto.plan.endsWith('yearly') ? 'year' : 'month',
        cta: dto.cta ?? null,
      },
    );
  }

  // POST /api/billing/interval : mensuel ↔ annuel en gardant le tarif (fondateur ou normal)
  @Post('interval')
  async changeInterval(
    @CurrentUser() user: { id: string },
    @Body() dto: ChangeIntervalDto,
  ) {
    return this.billing.changeInterval(user.id, dto.interval);
  }

  // GET /api/billing/portal : Portail de gestion abonnement Stripe
  @Get('portal')
  async portal(@CurrentUser() user: { id: string }) {
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:4200';
    return this.billing.createPortalSession(user.id, frontendUrl);
  }

  // POST /api/billing/webhook : PUBLIC (Stripe appelle directement, sans JWT)
  @Public()
  @Post('webhook')
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) {
      throw new BadRequestException('Header stripe-signature manquant');
    }
    if (!req.rawBody) {
      throw new BadRequestException(
        'Corps brut manquant : vérifier rawBody: true dans main.ts',
      );
    }
    return this.webhooks.handleWebhook(req.rawBody, signature);
  }
}
