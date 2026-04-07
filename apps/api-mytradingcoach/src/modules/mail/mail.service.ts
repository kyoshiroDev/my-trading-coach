import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import {
  paymentFailedTemplate,
  subscriptionCanceledTemplate,
  welcomePremiumTemplate,
} from './templates';

// ── Service Mail (Resend) ─────────────────────────────────────────────────────

@Injectable()
export class MailService {
  private readonly resend: Resend;
  private readonly from: string;
  private readonly frontendUrl: string;
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {
    this.resend = new Resend(this.config.getOrThrow<string>('RESEND_API_KEY'));
    this.from = this.config.get<string>('MAIL_FROM') ?? 'noreply@mytradingcoach.app';
    this.frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'https://app.mytradingcoach.app';
  }

  // ── Paiement échoué ────────────────────────────────────────────────────────

  async sendPaymentFailed(params: {
    to: string;
    userName: string;
    attemptCount: number;
  }): Promise<void> {
    const portalUrl = `${this.frontendUrl}/settings`;
    const { subject, html } = paymentFailedTemplate({
      userName: params.userName,
      attemptCount: params.attemptCount,
      portalUrl,
    });

    await this.send({ to: params.to, subject, html });
  }

  // ── Abonnement résilié ─────────────────────────────────────────────────────

  async sendSubscriptionCanceled(params: {
    to: string;
    userName: string;
  }): Promise<void> {
    const resubscribeUrl = `${this.frontendUrl}/settings`;
    const { subject, html } = subscriptionCanceledTemplate({
      userName: params.userName,
      resubscribeUrl,
    });

    await this.send({ to: params.to, subject, html });
  }

  // ── Bienvenue PREMIUM ──────────────────────────────────────────────────────

  async sendWelcomePremium(params: {
    to: string;
    userName: string;
    isTrial: boolean;
  }): Promise<void> {
    const appUrl = this.frontendUrl;
    const { subject, html } = welcomePremiumTemplate({
      userName: params.userName,
      isTrial: params.isTrial,
      appUrl,
    });

    await this.send({ to: params.to, subject, html });
  }

  // ── Envoi générique ────────────────────────────────────────────────────────

  private async send(params: {
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    const { data, error } = await this.resend.emails.send({
      from: this.from,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });

    if (error) {
      this.logger.error(
        `Erreur envoi email "${params.subject}" → ${params.to} : ${error.message}`,
      );
      // Ne pas throw — un email raté ne doit pas faire échouer le job BullMQ
      return;
    }

    this.logger.log(`Email envoyé — "${params.subject}" → ${params.to} (id: ${data?.id})`);
  }
}
