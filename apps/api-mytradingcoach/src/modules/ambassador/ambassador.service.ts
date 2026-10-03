import {
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUserCacheService } from '../infra/auth-user-cache.service';

// Lien de parrainage : même format que celui affiché par le dashboard ambassadeur.
const REFERRAL_BASE = 'https://mytradingcoach.app';
const buildReferralLink = (code: string) => `${REFERRAL_BASE}?ref=${code}`;

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function randomSuffix(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

export interface PromoteResult {
  email: string;
  name: string | null;
  role: Role;
  referralCode: string;
  referralLink: string;
}

export interface ReferralUser {
  id: string;
  name: string | null;
  email: string;
  plan: string;
  createdAt: Date;
  isActive: boolean;
}

export interface AmbassadorStats {
  referralCode: string;
  referrals: ReferralUser[];
  total: number;
  free: number;
  premium: number;
  earningsByMonth: Record<string, number>;
  totalEarned: number;
  pendingPayout: number;
}

@Injectable()
export class AmbassadorService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly userCache?: AuthUserCacheService,
  ) {}

  /** Marque toutes les commissions en attente d'un ambassadeur comme payées. */
  markAllPaid(ambassadorId: string) {
    return this.prisma.referralCommission.updateMany({
      where: { ambassadorId, status: 'pending' },
      data: { status: 'paid' },
    });
  }

  /**
   * Promeut un utilisateur en ambassadeur (remplace l'UPDATE SQL manuel).
   * Idempotent : si déjà ambassadeur, met à jour le code.
   * - code fourni → format déjà validé par le DTO + contrôle d'unicité (409).
   * - code absent → réutilise le code existant, sinon en génère un unique.
   */
  async promote(email: string, referralCode?: string): Promise<PromoteResult> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, referralCode: true },
    });
    if (!user) {
      throw new NotFoundException('Aucun utilisateur avec cet email');
    }

    let code: string;
    if (referralCode) {
      const owner = await this.prisma.user.findUnique({
        where: { referralCode },
        select: { id: true },
      });
      if (owner && owner.id !== user.id) {
        throw new ConflictException('Ce code est déjà utilisé, choisis-en un autre');
      }
      code = referralCode;
    } else {
      code = user.referralCode ?? (await this.generateUniqueCode(user.name, user.email));
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id: user.id },
        data: { role: Role.AMBASSADOR, referralCode: code },
        select: { email: true, name: true, role: true, referralCode: true },
      });
      await this.userCache?.invalidate(user.id); // rôle relu par le JWT (SCA-B3-01)
      return {
        email: updated.email,
        name: updated.name,
        role: updated.role,
        referralCode: updated.referralCode!,
        referralLink: buildReferralLink(updated.referralCode!),
      };
    } catch (err) {
      // Garde-fou course condition : la contrainte @unique a tranché.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Ce code est déjà utilisé, choisis-en un autre');
      }
      throw err;
    }
  }

  /**
   * Retire le statut ambassadeur : role → USER, referralCode vidé.
   * Ne touche pas aux commissions déjà enregistrées (referredBy des filleuls reste).
   */
  async revoke(email: string): Promise<{ email: string; name: string | null; role: Role }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('Aucun utilisateur avec cet email');
    }
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { role: Role.USER, referralCode: null },
      select: { email: true, name: true, role: true },
    });
    await this.userCache?.invalidate(user.id); // rôle relu par le JWT (SCA-B3-01)
    return updated;
  }

  /** Génère un code unique : slug du nom/email en MAJUSCULES, fallback aléatoire. */
  private async generateUniqueCode(
    name: string | null,
    email: string,
  ): Promise<string> {
    const source = name?.trim() ? name : email.split('@')[0];
    let base = source.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (base.length < 3) base = `${base}AMB`.slice(0, 3);

    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate =
        attempt === 0 ? base : `${base.slice(0, 12)}${randomSuffix(4)}`.slice(0, 20);
      const exists = await this.prisma.user.findUnique({
        where: { referralCode: candidate },
        select: { id: true },
      });
      if (!exists) return candidate;
    }
    return `AMB${randomSuffix(8)}`;
  }

  async listAmbassadors(): Promise<{
    id: string;
    name: string | null;
    email: string;
    referralCode: string;
    totalReferrals: number;
    premiumReferrals: number;
    totalEarned: number;
    pendingPayout: number;
  }[]> {
    // Le SEUL critère d'ambassadeur est le rôle. `referralCode` est partagé avec le
    // parrainage grand public : un USER qui génère son code en a un sans être
    // ambassadeur, et l'ancien `OR` le faisait apparaître ici.
    const ambassadors = await this.prisma.user.findMany({
      where: { role: Role.AMBASSADOR },
      select: {
        id: true,
        name: true,
        email: true,
        referralCode: true,
        referrals: {
          select: { amount: true, status: true, referredUserId: true },
        },
      },
    });

    const referralCounts = await this.prisma.user.groupBy({
      by: ['referredBy'],
      where: { referredBy: { not: null } },
      _count: { _all: true },
    });

    const premiumCounts = await this.prisma.user.groupBy({
      by: ['referredBy'],
      where: { referredBy: { not: null }, plan: 'PREMIUM' },
      _count: { _all: true },
    });

    const totalMap = Object.fromEntries(
      referralCounts.map((r) => [r.referredBy!, r._count._all]),
    );
    const premiumMap = Object.fromEntries(
      premiumCounts.map((r) => [r.referredBy!, r._count._all]),
    );

    return ambassadors.map((a) => {
      const totalEarned = a.referrals.reduce((s, r) => s + r.amount, 0);
      const pendingPayout = a.referrals
        .filter((r) => r.status === 'pending')
        .reduce((s, r) => s + r.amount, 0);
      return {
        id: a.id,
        name: a.name,
        email: a.email,
        referralCode: a.referralCode!,
        totalReferrals:   totalMap[a.referralCode!]   ?? 0,
        premiumReferrals: premiumMap[a.referralCode!]  ?? 0,
        totalEarned: +totalEarned.toFixed(2),
        pendingPayout: +pendingPayout.toFixed(2),
      };
    });
  }

  async getNewCount(userId: string, since: string): Promise<{ count: number }> {
    const ambassador = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });

    if (!ambassador?.referralCode) return { count: 0 };

    const sinceDate = since ? new Date(since) : new Date(0);

    const count = await this.prisma.user.count({
      where: {
        referredBy: ambassador.referralCode,
        createdAt: { gt: sinceDate },
      },
    });

    return { count };
  }

  async getStats(userId: string): Promise<AmbassadorStats> {
    const ambassador = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });

    if (!ambassador?.referralCode) {
      return {
        referralCode: '',
        referrals: [],
        total: 0,
        free: 0,
        premium: 0,
        earningsByMonth: {},
        totalEarned: 0,
        pendingPayout: 0,
      };
    }

    const referredUsers = await this.prisma.user.findMany({
      where: { referredBy: ambassador.referralCode },
      select: {
        id: true,
        name: true,
        email: true,
        plan: true,
        createdAt: true,
        _count: { select: { trades: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const free    = referredUsers.filter(u => u.plan === 'FREE').length;
    const premium = referredUsers.filter(u => u.plan === 'PREMIUM').length;

    const commissions = await this.prisma.referralCommission.findMany({
      where: { ambassadorId: userId },
      select: { amount: true, period: true, status: true },
    });

    const earningsByMonth: Record<string, number> = {};
    for (const c of commissions) {
      earningsByMonth[c.period] = (earningsByMonth[c.period] ?? 0) + c.amount;
    }

    const totalEarned = +commissions.reduce((s, c) => s + c.amount, 0).toFixed(2);
    const pendingPayout = +commissions
      .filter(c => c.status === 'pending')
      .reduce((s, c) => s + c.amount, 0)
      .toFixed(2);

    return {
      referralCode: ambassador.referralCode,
      referrals: referredUsers.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        plan: u.plan,
        createdAt: u.createdAt,
        isActive: u._count.trades > 0,
      })),
      total: referredUsers.length,
      free,
      premium,
      earningsByMonth,
      totalEarned,
      pendingPayout,
    };
  }
}
