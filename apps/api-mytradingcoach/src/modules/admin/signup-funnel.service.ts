import { Injectable } from '@nestjs/common';
import { todayParis, type AdminSignupFunnelData } from '@mtc/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { buildSignupFunnelErrors, buildSignupFunnelRows } from './signup-funnel.util';

/**
 * Parcours d'inscription par source (admin /acquisition) : visites landing + étapes anonymes
 * (clic CTA → page d'inscription → envoi → inscrit → paiement), par navigateur intégré ou non.
 * Aucune jointure User : ces compteurs ne contiennent ni compte, ni démo (la démo ne passe pas
 * par /register et ses mutations sont bloquées).
 */
@Injectable()
export class SignupFunnelService {
  constructor(private readonly prisma: PrismaService) {}

  async get(days: 7 | 30): Promise<AdminSignupFunnelData> {
    const from = new Date(`${todayParis()}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - (days - 1));

    const [visits, steps, errors] = await Promise.all([
      this.prisma.$queryRaw<{ source: string; medium: string; campaign: string; inApp: boolean; n: bigint }[]>`
        SELECT "source", "medium", "campaign", "inApp", SUM("visits") AS n
        FROM "LandingVisitDaily" WHERE "date" >= ${from}::date
        GROUP BY 1, 2, 3, 4 HAVING SUM("visits") > 0`,
      this.prisma.$queryRaw<{ source: string; medium: string; campaign: string; inApp: boolean; step: string; n: bigint }[]>`
        SELECT "source", "medium", "campaign", "inApp", "step", SUM("count") AS n
        FROM "FunnelEventDaily" WHERE "date" >= ${from}::date
        GROUP BY 1, 2, 3, 4, 5`,
      this.prisma.$queryRaw<{ source: string; inApp: boolean; code: string; n: bigint }[]>`
        SELECT "source", "inApp", "detail" AS code, SUM("count") AS n
        FROM "FunnelEventDaily" WHERE "date" >= ${from}::date AND "step" = 'register_error'
        GROUP BY 1, 2, 3`,
    ]);

    return {
      days,
      rows: buildSignupFunnelRows(
        visits.map((v) => ({ ...v, n: Number(v.n) })),
        steps.map((s) => ({ ...s, n: Number(s.n) })),
      ),
      errors: buildSignupFunnelErrors(errors.map((e) => ({ ...e, n: Number(e.n) }))),
    };
  }
}
