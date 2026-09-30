import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from '../resend/resend.service';

const DAY_MS = 24 * 3600_000;

/**
 * Récapitulatif quotidien des inscriptions, à l'admin (SCA-B0-07, audit scalabilité C4).
 *
 * Remplace l'e-mail admin envoyé à CHAQUE inscription : deux e-mails par inscription épuisaient
 * le quota Resend (100/jour en offre gratuite, soit ~50 inscriptions) et un pic d'inscriptions
 * saturait l'envoi. Un seul e-mail par jour, rien si personne ne s'est inscrit.
 * Exclut le compte démo et les admins.
 */
@Injectable()
export class SignupDigestCron {
  private readonly logger = new Logger(SignupDigestCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resend: ResendService,
  ) {}

  @Cron('0 8 * * *', { timeZone: 'Europe/Paris' })
  async sendDigest(now = new Date()): Promise<number> {
    const since = new Date(now.getTime() - DAY_MS);
    const users = await this.prisma.user.findMany({
      where: { createdAt: { gte: since, lt: now }, isDemo: false, role: { not: Role.ADMIN } },
      select: { email: true, name: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    if (users.length === 0) return 0;

    const fmt = (d: Date) => d.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
    const lines = users.map((u) => `- ${fmt(u.createdAt)} · ${u.name ?? '(nom non renseigné)'} · ${u.email}`);
    await this.resend
      .sendAdminAlert(
        `🆕 ${users.length} inscription${users.length > 1 ? 's' : ''} sur les dernières 24 h`,
        `Du ${fmt(since)} au ${fmt(now)} :\n\n${lines.join('\n')}`,
      )
      .catch((err: unknown) => this.logger.error(`Récap des inscriptions non envoyé : ${String(err)}`));
    this.logger.log(`Récap des inscriptions : ${users.length} nouvel(s) inscrit(s).`); // pas d'e-mail dans les logs
    return users.length;
  }
}
