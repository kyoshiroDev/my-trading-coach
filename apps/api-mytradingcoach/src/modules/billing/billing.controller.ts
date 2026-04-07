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
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
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
    @Body() dto: CreateCheckoutDto,
  ) {
    const priceId =
      dto.plan === 'yearly'
        ? this.config.getOrThrow<string>('STRIPE_PRICE_YEARLY')
        : this.config.getOrThrow<string>('STRIPE_PRICE_MONTHLY');

    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:4200';

    return this.billing.createCheckoutSession(
      user.id,
      user.email,
      priceId,
      frontendUrl,
    );
  }

  // GET /api/billing/portal — JWT requis (guard global)
  @Get('portal')
  async portal(@CurrentUser() user: { id: string }) {
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:4200';
    return this.billing.createPortalSession(user.id, frontendUrl);
  }

  // POST /api/billing/webhook — PUBLIC (Stripe appelle directement, sans JWT)
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
      throw new BadRequestException('Corps brut manquant — vérifier rawBody: true dans main.ts');
    }
    return this.billing.handleWebhook(req.rawBody, signature);
  }
}
