import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import * as Sentry from '@sentry/nestjs';
import type { Queue } from 'bullmq';
import { Resend } from 'resend';
import { RedisService } from '../infra/redis.service';
import { EMAIL_JOB_OPTIONS, EMAIL_QUEUE, RETRYABLE_EMAIL_ERRORS, RetryableEmailError, type EmailJob } from './email-queue';
import {
  annualRenewalReminderTemplate,
  founderWelcomeTemplate,
  partnerWelcomeTemplate,
  tariffAtRiskTemplate,
  dailyRecapTemplate,
  debriefReadyTemplate,
  paymentFailedTemplate,
  paymentSucceededTemplate,
  renewalReminderTemplate,
  resetPasswordTemplate,
  subscriptionCanceledTemplate,
  welcomeFreeTemplate,
  welcomePremiumTemplate,
} from './templates';

// Boîte interne de réception (candidatures ambassadeur, relevés). Aligné sur
// sendAdminAlert (inbox éprouvée du projet).
const CONTACT_INBOX = 'hello@mytradingcoach.app';

// Plan gratuit Resend : 100 e-mails/jour (remise à zéro à minuit UTC), 3 000/mois. Décision du
// 2026-10-01 : passer au plan Pro dès qu'on dépasse 80 envois/jour → alerte Sentry à ce seuil.
export const RESEND_DAILY_WARN = 80;
// Adresse de l'app de prod : RESEND_DRY_RUN y est ignoré (garde-fou, voir le constructeur).
const PROD_FRONTEND_URL = 'https://app.mytradingcoach.app';

// Envoi direct (file indisponible) : quelques essais sur place en cas de 429 ou de panne passagère.
// Depuis la file, c'est BullMQ qui réessaie (EMAIL_JOB_OPTIONS).
const DIRECT_RETRY_DELAYS_MS = [1000, 2000, 4000];
const QUOTA_ERRORS = new Set(['daily_quota_exceeded', 'monthly_quota_exceeded']);

/** `jean.dupont@gmail.com` → `j***@gmail.com` : diagnostic possible sans adresse complète dans les logs. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? `${email[0]}***${email.slice(at)}` : '***';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
}

// ── Service Mail (Resend) ─────────────────────────────────────────────────────

@Injectable()
export class ResendService {
  private readonly resend: Resend;
  private readonly from: string;
  private readonly frontendUrl: string;
  /** Page Profil > Paramètres : « Gérer mon abonnement » ouvre le portail Stripe (carte). */
  private readonly billingUrl: string;
  private readonly logger = new Logger(ResendService.name);

  private readonly replyTo: string;
  /**
   * `RESEND_DRY_RUN=true` (tests de charge sur beta, #487) : chaque e-mail est journalisé au lieu
   * d'être envoyé. Pas d'adresses inexistantes chez Resend (réputation du domaine), pas de quota
   * consommé. Ignoré en prod : un e-mail de prod ne doit jamais pouvoir disparaître ainsi.
   */
  private readonly dryRun: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    @InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue<EmailJob>,
  ) {
    const apiKey = this.config.getOrThrow<string>('RESEND_API_KEY');
    this.resend = new Resend(apiKey);
    const mailFrom =
      this.config.get<string>('MAIL_FROM') ?? 'noreply@mytradingcoach.app';
    this.from = `MyTradingCoach <${mailFrom}>`;
    this.replyTo =
      this.config.get<string>('MAIL_SAV') ?? 'hello@mytradingcoach.app';
    this.frontendUrl =
      this.config.get<string>('FRONTEND_URL') ??
      'https://app.mytradingcoach.app';
    // Champ, pas un getter : le double des tests d'intégration est dérivé du prototype.
    this.billingUrl = `${this.frontendUrl}/profil?tab=params`;
    this.logger.log(
      `ResendService init | from: ${this.from} | key: ${apiKey.slice(0, 8)}...`,
    );
    const dryRunAsked = this.config.get<string>('RESEND_DRY_RUN') === 'true';
    this.dryRun = dryRunAsked && this.frontendUrl !== PROD_FRONTEND_URL;
    if (dryRunAsked && !this.dryRun) this.logger.error('RESEND_DRY_RUN ignoré : environnement de prod');
    if (this.dryRun) {
      this.logger.warn('RESEND_DRY_RUN actif : AUCUN e-mail ne part (journalisés seulement)');
      // Point unique : couvre la file (deliver) ET les envois directs (alerte admin, ambassadeur).
      this.resend.emails.send = (async (payload: { to: string | string[]; subject: string }) => {
        const to = (Array.isArray(payload.to) ? payload.to : [payload.to]).map(maskEmail).join(', ');
        this.logger.log(`[RESEND DRY RUN] "${payload.subject}" → ${to} (non envoyé)`);
        return { data: { id: 'dry-run' }, error: null, headers: null };
      }) as unknown as Resend['emails']['send'];
    }
  }

  // ── Bienvenue FREE ─────────────────────────────────────────────────────────

  async sendWelcomeFree(params: {
    to: string;
    userName: string;
  }): Promise<void> {
    const { subject, html } = welcomeFreeTemplate({
      userName: params.userName,
      appUrl: this.frontendUrl,
    });
    await this.send({ to: params.to, subject, html });
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

  // ── Paiement réussi ────────────────────────────────────────────────────────

  async sendPaymentSucceeded(params: {
    to: string;
    userName: string;
    amount: string;
    last4?: string;
    nextRenewalDate?: Date | null;
    invoiceUrl?: string;
  }): Promise<void> {
    const { to, ...rest } = params;
    const { subject, html } = paymentSucceededTemplate({ ...rest, appUrl: this.frontendUrl });

    await this.send({ to, subject, html });
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

  // ── Réinitialisation mot de passe ─────────────────────────────────────────

  async sendResetPassword(params: {
    to: string;
    userName: string;
    resetToken: string;
  }): Promise<void> {
    const resetUrl = `${this.frontendUrl}/reset-password?token=${params.resetToken}`;
    const { subject, html } = resetPasswordTemplate({
      userName: params.userName,
      resetUrl,
      expiresIn: '1 heure',
    });
    await this.send({ to: params.to, subject, html });
  }

  // ── Débrief prêt ──────────────────────────────────────────────────────────

  async sendDebriefReady(params: {
    to: string;
    userName: string;
    weekNumber: number;
    winRate: number;
    totalPnl: number;
    totalTrades: number;
    /** Devise des comptes ; null si elles diffèrent. */
    currency: string | null;
  }): Promise<void> {
    const { subject, html } = debriefReadyTemplate({
      ...params,
      appUrl: this.frontendUrl,
    });
    await this.send({ to: params.to, subject, html });
  }

  // ── Rappel renouvellement ──────────────────────────────────────────────────

  async sendRenewalReminder(params: {
    to: string;
    userName: string;
    expiresAt: Date;
  }): Promise<void> {
    const portalUrl = `${this.frontendUrl}/settings`;
    const { subject, html } = renewalReminderTemplate({ ...params, portalUrl });
    await this.send({ to: params.to, subject, html });
  }

  // ── Offre fondateur et codes partenaires (#525) ─────────────────────────────

  async sendFounderWelcome(params: {
    to: string;
    userName: string;
    number: number;
    priceLabel: string;
    refundUntil: Date;
  }): Promise<void> {
    const { to, ...rest } = params;
    const { subject, html } = founderWelcomeTemplate({ ...rest, appUrl: this.frontendUrl });
    await this.send({ to, subject, html });
  }

  async sendPartnerWelcome(params: {
    to: string;
    userName: string;
    code: string;
    priceLabel: string;
    normalPriceLabel: string;
    durationMonths: number | null;
    trialEndsAt: Date | null;
  }): Promise<void> {
    const { to, ...rest } = params;
    const { subject, html } = partnerWelcomeTemplate({ ...rest, appUrl: this.frontendUrl });
    await this.send({ to, subject, html });
  }

  async sendTariffAtRisk(params: {
    to: string;
    userName: string;
    kind: 'founder' | 'partner';
    priceLabel: string;
    attemptCount: number;
  }): Promise<void> {
    const { to, ...rest } = params;
    const { subject, html } = tariffAtRiskTemplate({ ...rest, portalUrl: this.billingUrl });
    await this.send({ to, subject, html });
  }

  async sendAnnualRenewalReminder(params: {
    to: string;
    userName: string;
    amount: string;
    renewalDate: Date;
    keptTariff: string | null;
  }): Promise<void> {
    const { to, ...rest } = params;
    const { subject, html } = annualRenewalReminderTemplate({ ...rest, portalUrl: this.billingUrl });
    await this.send({ to, subject, html });
  }

  // ── Daily Recap ───────────────────────────────────────────────────────────

  async sendDailyRecap(
    user: { email: string; name: string | null },
    recap: { date: Date; pnl: number; winRate: number; tradesCount: number; aiOneLiner: string | null },
    /** Devise des comptes ; null si elles diffèrent. */
    currency: string | null,
  ): Promise<void> {
    const { subject, html } = dailyRecapTemplate({
      userName: user.name ?? 'Trader',
      date: recap.date,
      pnl: recap.pnl,
      winRate: recap.winRate,
      tradesCount: recap.tradesCount,
      aiOneLiner: recap.aiOneLiner,
      currency,
      appUrl: this.frontendUrl,
    });
    await this.send({ to: user.email, subject, html });
  }

  // ── Alerte admin ──────────────────────────────────────────────────────────

  async sendAdminAlert(subject: string, body: string): Promise<void> {
    try {
      await this.resend.emails.send({
        from: 'noreply@mytradingcoach.app',
        to: 'hello@mytradingcoach.app',
        subject,
        html: `<pre style="font-family:monospace;font-size:14px">${body}</pre>`,
      });
    } catch (err) {
      this.logger.error('Erreur sendAdminAlert', err);
    }
  }

  // ── Demande pour devenir ambassadeur (lean, par email) ─────────────────────

  async sendAmbassadorApplication(params: {
    name: string;
    email: string;
    socials: string;
    message?: string;
  }): Promise<void> {
    const body =
      `Nom      : ${params.name}\n` +
      `Email    : ${params.email}\n` +
      `Réseaux  : ${params.socials}\n` +
      `Message  : ${params.message?.trim() || '(aucun)'}\n` +
      `Date     : ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`;
    try {
      await this.resend.emails.send({
        from: 'noreply@mytradingcoach.app',
        to: CONTACT_INBOX,
        replyTo: params.email,
        subject: `🤝 Demande ambassadeur · ${params.name}`,
        html: `<pre style="font-family:monospace;font-size:14px">${escapeHtml(body)}</pre>`,
      });
    } catch (err) {
      this.logger.error('Erreur sendAmbassadorApplication', err);
      throw err;
    }
  }

  // ── Relevé de commissions ambassadeur (PDF, PAS une facture) ──────────────

  async sendAmbassadorStatement(params: {
    ambassadorName: string;
    ambassadorEmail: string;
    period: string;
    pdf: Buffer;
  }): Promise<void> {
    await this.resend.emails.send({
      from: this.from,
      to: CONTACT_INBOX,
      replyTo: params.ambassadorEmail,
      subject: `Relevé de commissions · ${escapeHtml(params.ambassadorName)} (${params.period})`,
      html:
        `<p>Relevé de commissions de <strong>${escapeHtml(params.ambassadorName)}</strong> ` +
        `pour la période ${params.period} en pièce jointe.</p>` +
        `<p style="color:#666;font-size:13px">Ce relevé sert de base à la facture de l'ambassadeur. Ce n'est pas une facture.</p>`,
      attachments: [
        {
          filename: `releve-commissions-${params.period}.pdf`,
          content: params.pdf.toString('base64'),
        },
      ],
    });
  }

  // ── Envoi générique ────────────────────────────────────────────────────────

  /**
   * Met l'e-mail en file (SCA-B5-02) : `EmailProcessor` l'envoie à débit plafonné et réessaie les
   * erreurs passagères. File indisponible (Redis en panne) → envoi direct, pour ne pas le perdre.
   * Ne lève jamais : un e-mail raté ne doit pas faire échouer l'action qui l'a déclenché.
   */
  async send(params: EmailJob): Promise<void> {
    try {
      await this.emailQueue.add('send', params, EMAIL_JOB_OPTIONS);
    } catch (err) {
      this.logger.warn(`File e-mail indisponible, envoi direct à ${maskEmail(params.to)} : ${String(err)}`);
      await this.deliver(params);
    }
  }

  /**
   * Envoi effectif à Resend.
   * - Direct (sans `queued`) : quelques essais sur place, puis abandon signalé à Sentry.
   * - Depuis la file : un seul essai ; une erreur passagère lève `RetryableEmailError` pour que
   *   BullMQ réessaie, sauf au dernier essai où l'abandon est signalé. `idempotencyKey` : un essai
   *   qui avait abouti chez Resend malgré une réponse perdue n'envoie pas de doublon.
   */
  async deliver(params: EmailJob, queued?: { lastAttempt: boolean; idempotencyKey: string }): Promise<void> {
    const to = maskEmail(params.to);
    this.logger.debug(`Envoi email | from: "${params.from ?? this.from}" to: "${to}" subject: "${params.subject}"`);

    for (let attempt = 0; ; attempt++) {
      const { data, error } = await this.resend.emails
        .send(
          {
            from: params.from ?? this.from,
            to: params.to,
            subject: params.subject,
            html: params.html,
            replyTo: params.replyTo ?? this.replyTo,
            ...(params.text ? { text: params.text } : {}),
            ...(params.attachments?.length ? { attachments: params.attachments } : {}),
          },
          queued ? { idempotencyKey: queued.idempotencyKey } : undefined,
        )
        // Le SDK renvoie d'ordinaire l'erreur ; une exception (réseau) est traitée comme passagère.
        .catch((err: unknown) => ({ data: null, error: { name: 'application_error', message: String(err) } }));

      if (!error) {
        this.logger.log(`[RESEND OK] "${params.subject}" → ${to} (id: ${data?.id})`);
        if (!this.dryRun) await this.countSent(); // simulation : pas d'alerte de quota pour rien
        return;
      }

      const retryable = RETRYABLE_EMAIL_ERRORS.has(error.name);
      if (retryable && !queued && attempt < DIRECT_RETRY_DELAYS_MS.length) {
        await this.sleep(DIRECT_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      if (retryable && queued && !queued.lastAttempt) {
        this.logger.warn(`[RESEND RETRY] "${params.subject}" → ${to} | ${error.name} : ${error.message}`);
        throw new RetryableEmailError(error.name, error.message);
      }

      this.logger.error(`[RESEND ERROR] "${params.subject}" → ${to} | ${error.name} : ${error.message}`);
      // Un échec d'envoi était silencieux (logs seulement). Sentry, regroupé par type d'erreur :
      // un quota dépassé = une seule issue, pas une par e-mail.
      Sentry.captureMessage(`Resend : ${error.name}`, {
        level: QUOTA_ERRORS.has(error.name) ? 'fatal' : 'error',
        fingerprint: ['resend-send-failed', error.name],
        tags: { resend_error: error.name },
        extra: { subject: params.subject, message: error.message, attempts: attempt + 1, queued: !!queued },
      });
      return;
    }
  }

  /**
   * Compte les envois réussis du jour (UTC, comme le quota Resend) et prévient Sentry au seuil
   * RESEND_DAILY_WARN. Redis indisponible → on n'empêche jamais l'envoi.
   * Propriété (pas méthode) : hors du prototype, donc hors du contrat que le double de test
   * `createResendMock()` doit couvrir (resend-neutralized.int-spec.ts).
   */
  private readonly countSent = async (): Promise<void> => {
    try {
      const key = `resend:sent:${new Date().toISOString().slice(0, 10)}`;
      const sent = await this.redis.client.incr(key);
      if (sent === 1) await this.redis.client.expire(key, 3 * 24 * 3600);
      if (sent === RESEND_DAILY_WARN) {
        this.logger.warn(`${sent} e-mails envoyés aujourd'hui (plan gratuit : 100/jour)`);
        // Niveau `error` et non `warning` : la règle d'alerte Sentry (« high priority issues »)
        // n'envoie d'e-mail que pour la priorité haute, et Sentry classe `warning` en moyenne.
        Sentry.captureMessage(`Resend : ${sent} e-mails envoyés aujourd'hui, passer au plan Pro`, {
          level: 'error',
          fingerprint: ['resend-daily-volume'],
          extra: { sent, freePlanDailyLimit: 100 },
        });
      }
    } catch (err) {
      this.logger.warn(`Compteur d'envois indisponible : ${String(err)}`);
    }
  };

  // Propriété remplaçable par les tests (pas d'attente réelle) ; hors prototype, comme countSent.
  protected readonly sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));
}
