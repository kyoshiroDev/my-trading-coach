import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Préférences email côté données (règle projet : Prisma dans les services, jamais dans un
 * controller). Distinct de `ResendService`, qui ne fait qu'envoyer.
 */
@Injectable()
export class EmailsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Désinscription par le token unique du lien. Sans portée : e-mails marketing ET e-mails de
   * service (aide à la prise en main) ; `service` : seulement ces derniers. Token absent ou
   * inconnu : rien à faire (0 ligne), la page de confirmation reste la même — elle ne révèle pas si
   * le token existe.
   */
  async unsubscribe(token: string | undefined, scope?: 'service'): Promise<number> {
    if (!token) return 0;
    const now = new Date();
    const { count } = await this.prisma.user.updateMany({
      where: { unsubToken: token },
      data:
        scope === 'service'
          ? { serviceEmailsOptOutAt: now }
          : { marketingConsent: false, marketingConsentAt: null, serviceEmailsOptOutAt: now },
    });
    return count;
  }
}
