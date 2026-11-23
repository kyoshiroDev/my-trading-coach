import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { FounderSeatStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from '../resend/resend.service';
import { UsersService } from '../users/users.service';
import {
  INACTIVITY_NOTICE_CAMPAIGN, lastActivity, nextInactivityAction, parisDay, selectionCutoff,
} from './inactivity-purge.util';
import { INACTIVITY_NOTICE_COUNT } from '@mtc/shared';

/** Plafonds par passage : pas de rafale Stripe ni Resend (le reste passe le lendemain). */
export const INACTIVITY_MAX_DELETIONS = 50;
export const INACTIVITY_MAX_NOTICES = 500;
/** Comptes examinés par passage, les plus anciens d'abord. */
export const INACTIVITY_SCAN_LIMIT = 5_000;

/** Statuts Stripe qui ne protègent plus le compte : abonnement terminé. */
const ENDED_SUBSCRIPTION = ['canceled', 'incomplete_expired'];

/**
 * Comptes éligibles à la purge (#824) : dernière connexion avant `cutoff`, et aucune exclusion.
 * La dernière activité = max(lastSeenAt, lastLoginAt), sinon createdAt (toujours ≤ aux deux autres) :
 * elle est avant `cutoff` si et seulement si les trois dates connues le sont.
 */
export function inactiveWhere(now: Date, cutoff: Date): Prisma.UserWhereInput {
  return {
    AND: [
      ...inactiveSince(cutoff),
      { isDemo: false },
      { role: { not: Role.ADMIN } },
      { OR: [{ stripeSubscriptionStatus: null }, { stripeSubscriptionStatus: { in: ENDED_SUBSCRIPTION } }] },
      { OR: [{ stripeCurrentPeriodEnd: null }, { stripeCurrentPeriodEnd: { lte: now } }] },
      { OR: [{ trialEndsAt: null }, { trialEndsAt: { lte: now } }] },
      { OR: [{ signupTrialEndsAt: null }, { signupTrialEndsAt: { lte: now } }] },
      { NOT: { founderSeat: { is: { status: FounderSeatStatus.ACTIVE } } } },
      { NOT: { referrals: { some: { status: 'pending' } } } },
    ],
  };
}

function inactiveSince(cutoff: Date): Prisma.UserWhereInput[] {
  return [
    { OR: [{ lastSeenAt: null }, { lastSeenAt: { lte: cutoff } }] },
    { OR: [{ lastLoginAt: null }, { lastLoginAt: { lte: cutoff } }] },
    { createdAt: { lte: cutoff } },
  ];
}

/** Motifs d'exclusion comptés en journal seul (comptes inactifs protégés, par motif). */
function exclusionFilters(now: Date): Record<string, Prisma.UserWhereInput> {
  return {
    demo: { isDemo: true },
    admin: { role: Role.ADMIN },
    abonnement: { stripeSubscriptionStatus: { notIn: ENDED_SUBSCRIPTION } },
    periodePayee: { stripeCurrentPeriodEnd: { gt: now } },
    essai: { OR: [{ trialEndsAt: { gt: now } }, { signupTrialEndsAt: { gt: now } }] },
    fondateur: { founderSeat: { is: { status: FounderSeatStatus.ACTIVE } } },
    commission: { referrals: { some: { status: 'pending' } } },
  };
}

export interface InactivityReport {
  enabled: boolean;
  /** Préavis dus (journal seul) ou envoyés (actif), par rang 1 à 4. */
  notices: number[];
  /** Suppressions dues (journal seul) ou faites (actif). */
  deletions: number;
  /** Préavis ou suppressions en échec (Resend, Stripe injoignable…), retentés au prochain passage. */
  failures: number;
  /** Actions reportées au lendemain par les plafonds. */
  deferred: number;
  /** Comptes inactifs protégés, par motif (journal seul). */
  excluded?: Record<string, number>;
}

/**
 * Purge des comptes inactifs depuis 2 ans (#824, décision de Greg du 2026-11-23). Un passage par jour
 * sur le worker cron : préavis chaque semaine du dernier mois, puis suppression par le même chemin
 * qu'une suppression demandée. `INACTIVITY_PURGE_ENABLED` absente ou différente de `true` = journal
 * seul : rien n'est écrit, envoyé ni supprimé, seuls des comptes sont journalisés.
 */
@Injectable()
export class InactivityPurgeService {
  private readonly logger = new Logger(InactivityPurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly resend: ResendService,
    private readonly config: ConfigService,
  ) {}

  get enabled(): boolean {
    return this.config.get<string>('INACTIVITY_PURGE_ENABLED') === 'true';
  }

  // 10 h Paris : l'e-mail arrive le matin, longtemps après les sauvegardes de 3 h.
  @Cron('0 10 * * *', { timeZone: 'Europe/Paris' })
  async scheduled(): Promise<void> {
    try {
      await this.run();
    } catch (err: unknown) {
      this.logger.error(`Purge des comptes inactifs en échec : ${err instanceof Error ? err.name : 'Error'}`);
    }
  }

  async run(now = new Date()): Promise<InactivityReport> {
    const enabled = this.enabled;
    const today = parisDay(now);
    const cutoff = selectionCutoff(now);
    const candidates = await this.prisma.user.findMany({
      where: inactiveWhere(now, cutoff),
      select: {
        id: true, email: true, name: true, lastSeenAt: true, lastLoginAt: true, createdAt: true,
        emailSends: { where: { campaignKey: INACTIVITY_NOTICE_CAMPAIGN }, select: { sentAt: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: INACTIVITY_SCAN_LIMIT,
    });

    const report: InactivityReport = {
      enabled, notices: Array(INACTIVITY_NOTICE_COUNT).fill(0), deletions: 0, failures: 0, deferred: 0,
    };
    for (const u of candidates) {
      const activity = lastActivity(u);
      // Préavis du cycle en cours : envoyés après la dernière connexion (une connexion remet à zéro).
      const notices = u.emailSends.map((e) => e.sentAt).filter((d) => d > activity);
      const action = nextInactivityAction(today, activity, notices);
      if (action.kind === 'notice') {
        const sent = report.notices.reduce((a, b) => a + b, 0);
        if (enabled && sent >= INACTIVITY_MAX_NOTICES) { report.deferred++; continue; }
        if (enabled) {
          try {
            await this.sendNotice(u, action.rank, action.deletionDay, now);
          } catch (err: unknown) {
            // Non envoyé : aucun préavis enregistré, il repart au prochain passage (la date ne fait que reculer).
            report.failures++;
            this.logger.error(`Préavis d'inactivité du compte ${u.id} non envoyé : ${err instanceof Error ? err.name : 'Error'}`);
            continue;
          }
        }
        report.notices[action.rank - 1]++;
      } else if (action.kind === 'delete') {
        if (enabled && report.deletions + report.failures >= INACTIVITY_MAX_DELETIONS) { report.deferred++; continue; }
        if (!enabled) { report.deletions++; continue; }
        // Relu juste avant : une connexion pendant le passage (lu une seule fois au début) annule la purge.
        const stillInactive = await this.prisma.user.count({ where: { AND: [inactiveWhere(now, cutoff), { id: u.id }] } });
        if (!stillInactive) continue;
        try {
          await this.users.deleteForInactivity(u.id);
          report.deletions++;
        } catch (err: unknown) {
          report.failures++;
          this.logger.error(`Purge du compte ${u.id} reportée : ${err instanceof Error ? err.name : 'Error'}`);
        }
      }
    }
    if (!enabled) report.excluded = await this.countExclusions(now, cutoff);
    this.logger.log(
      `Comptes inactifs ${enabled ? '' : '(journal seul) '}| préavis ${report.notices.join('/')}, ` +
        `suppressions ${report.deletions}, échecs ${report.failures}, reportés ${report.deferred}` +
        (report.excluded ? `, exclus ${JSON.stringify(report.excluded)}` : ''),
    );
    return report;
  }

  private async sendNotice(
    u: { id: string; email: string; name: string | null },
    rank: number,
    deletionDay: string,
    now: Date,
  ): Promise<void> {
    await this.resend.sendInactivityNotice({ to: u.email, userName: u.name, deletionDay, last: rank === INACTIVITY_NOTICE_COUNT });
    await this.prisma.emailSend.create({
      data: { campaignKey: INACTIVITY_NOTICE_CAMPAIGN, userId: u.id, kind: 'transactional', sentAt: now },
    });
  }

  /** Comptes inactifs depuis le seuil de sélection, protégés par chaque motif (un compte peut en cumuler). */
  private async countExclusions(now: Date, cutoff: Date): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const [reason, filter] of Object.entries(exclusionFilters(now))) {
      out[reason] = await this.prisma.user.count({ where: { AND: [...inactiveSince(cutoff), filter] } });
    }
    return out;
  }
}
