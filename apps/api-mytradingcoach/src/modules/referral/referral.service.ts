import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from '../resend/resend.service';
import { StripeService } from '../stripe/stripe.service';
import { buildStatementPdf } from './referral-statement.pdf';

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

/** Pseudo masqué : 2 premières lettres + étoiles (RGPD côté parrain). */
function maskPseudo(name: string | null, email: string): string {
  const base = (name?.trim() || email.split('@')[0] || '?').trim();
  const head = base.slice(0, 2).toUpperCase();
  return `${head}${'*'.repeat(Math.max(3, Math.min(6, base.length - 2)))}`;
}

type FilleulStatus = 'payant' | 'essai' | 'inscrit';
function filleulStatus(u: { plan: string; stripeSubscriptionStatus: string | null }): FilleulStatus {
  if (u.stripeSubscriptionStatus === 'active' && u.plan !== 'FREE') return 'payant';
  if (u.stripeSubscriptionStatus === 'trialing') return 'essai';
  return 'inscrit';
}

@Injectable()
export class ReferralService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resend: ResendService,
    private readonly stripe: StripeService,
  ) {}

  // ── ÉTAPE 1 : tout le monde peut être parrain ──────────────────────────────

  /** Garantit un referralCode unique à l'user (génère à la volée si absent). */
  async ensureReferralCode(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true, name: true, email: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (user.referralCode) return user.referralCode;

    const code = await this.generateUniqueCode(user.name, user.email);
    try {
      await this.prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
      return code;
    } catch (err) {
      // Course condition : un autre process a posé un code entre-temps → relire.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const fresh = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { referralCode: true },
        });
        if (fresh?.referralCode) return fresh.referralCode;
      }
      throw err;
    }
  }

  private async generateUniqueCode(name: string | null, email: string): Promise<string> {
    const source = name?.trim() ? name : email.split('@')[0];
    let base = source.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (base.length < 3) base = `${base}REF`.slice(0, 3);

    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = attempt === 0 ? base : `${base.slice(0, 12)}${randomSuffix(4)}`.slice(0, 20);
      const exists = await this.prisma.user.findUnique({
        where: { referralCode: candidate },
        select: { id: true },
      });
      if (!exists) return candidate;
    }
    return `REF${randomSuffix(8)}`;
  }

  // ── ÉTAPE 4 : stats parrain ─────────────────────────────────────────────────

  async getMyReferral(userId: string) {
    const code = await this.ensureReferralCode(userId);

    const filleuls = await this.prisma.user.findMany({
      where: { referredBy: code, isDemo: false },
      select: {
        id: true, name: true, email: true, plan: true,
        stripeSubscriptionStatus: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const rewards = await this.prisma.referralReward.findMany({
      where: { parrainId: userId },
      select: { filleulId: true, status: true },
    });
    const rewardedIds = new Set(rewards.map((r) => r.filleulId));
    const freeMonthsEarned = rewards.filter((r) => r.status === 'APPLIED').length;

    const subscribed = filleuls.filter(
      (f) => f.plan !== 'FREE' && f.stripeSubscriptionStatus === 'active',
    ).length;

    const creditAvailable = await this.stripe.getCustomerBalanceCreditEur(userId);

    return {
      referralCode: code,
      link: buildReferralLink(code),
      invited: filleuls.length,
      subscribed,
      freeMonthsEarned,
      creditAvailable,
      filleuls: filleuls.map((f) => ({
        pseudo: maskPseudo(f.name, f.email),
        date: f.createdAt,
        status: filleulStatus(f),
        rewarded: rewardedIds.has(f.id),
      })),
    };
  }

  // ── ÉTAPE 4 : overview admin (parrainage grand public, démo exclus) ─────────

  async getAdminOverview() {
    // Parrains « grand public » : ont un code, hors ambassadeurs (dashboard dédié).
    const parrains = await this.prisma.user.findMany({
      where: { referralCode: { not: null }, isDemo: false, role: { not: 'AMBASSADOR' } },
      select: { id: true, referralCode: true, name: true, email: true },
    });
    const codes = parrains.map((p) => p.referralCode!).filter(Boolean);

    const [invitedGroups, payantGroups, rewardGroups, recent] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['referredBy'],
        where: { referredBy: { in: codes }, isDemo: false },
        _count: { _all: true },
      }),
      this.prisma.user.groupBy({
        by: ['referredBy'],
        where: { referredBy: { in: codes }, isDemo: false, stripeSubscriptionStatus: 'active', plan: { not: 'FREE' } },
        _count: { _all: true },
      }),
      this.prisma.referralReward.groupBy({
        by: ['parrainId', 'status'],
        _count: { _all: true },
      }),
      this.prisma.user.findMany({
        where: { referredBy: { in: codes }, isDemo: false },
        select: { name: true, email: true, plan: true, stripeSubscriptionStatus: true, createdAt: true, referredBy: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const invitedMap = Object.fromEntries(invitedGroups.map((g) => [g.referredBy!, g._count._all]));
    const payantMap = Object.fromEntries(payantGroups.map((g) => [g.referredBy!, g._count._all]));

    const appliedByParrain: Record<string, number> = {};
    const pendingByParrain: Record<string, number> = {};
    for (const g of rewardGroups) {
      if (g.status === 'APPLIED') appliedByParrain[g.parrainId] = g._count._all;
      else pendingByParrain[g.parrainId] = g._count._all;
    }

    const parrainsList = parrains
      .map((p) => {
        const invited = invitedMap[p.referralCode!] ?? 0;
        const payants = payantMap[p.referralCode!] ?? 0;
        const applied = appliedByParrain[p.id] ?? 0;
        const pending = pendingByParrain[p.id] ?? 0;
        return {
          referralCode: p.referralCode!,
          name: p.name,
          email: p.email,
          invited,
          payants,
          conversion: invited > 0 ? Math.round((payants / invited) * 100) : 0,
          moisGagnes: applied + pending,
          moisAppliques: applied,
        };
      })
      .filter((p) => p.invited > 0)
      .sort((a, b) => b.payants - a.payants || b.invited - a.invited);

    const invitesTotal = parrainsList.reduce((s, p) => s + p.invited, 0);
    const payants = parrainsList.reduce((s, p) => s + p.payants, 0);
    const moisAccordes = Object.values(appliedByParrain).reduce((s, n) => s + n, 0);
    const moisAAppliquer = Object.values(pendingByParrain).reduce((s, n) => s + n, 0);

    return {
      parrainsActifs: parrainsList.length,
      invitesTotal,
      payants,
      tauxConversion: invitesTotal > 0 ? Math.round((payants / invitesTotal) * 100) : 0,
      moisAccordes,
      moisAAppliquer,
      parrains: parrainsList,
      filleulsRecents: recent.map((f) => ({
        pseudo: maskPseudo(f.name, f.email),
        parrainCode: f.referredBy,
        status: filleulStatus(f),
        date: f.createdAt,
      })),
    };
  }

  // ── ÉTAPE 6 : demande ambassadeur (lean, email) ────────────────────────────

  async applyAmbassador(userId: string, dto: { socials: string; message?: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    await this.resend.sendAmbassadorApplication({
      name: user.name ?? '(non renseigné)',
      email: user.email,
      socials: dto.socials,
      message: dto.message,
    });
    return { success: true };
  }

  // ── ÉTAPE 5 : relevé de commissions ambassadeur (PDF, pas une facture) ──────

  async generateStatement(userId: string): Promise<{ pdf: Buffer; period: string; filename: string }> {
    const amb = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    if (!amb) throw new NotFoundException('Utilisateur introuvable');

    const period = new Date().toISOString().slice(0, 7); // YYYY-MM
    const commissions = await this.prisma.referralCommission.findMany({
      where: { ambassadorId: userId, period },
      select: { amount: true, referredUserId: true },
    });

    const filleulIds = commissions.map((c) => c.referredUserId);
    const filleuls = filleulIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: filleulIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const nameById = new Map(filleuls.map((f) => [f.id, maskPseudo(f.name, f.email)]));

    const lines = commissions.map((c) => ({
      filleul: nameById.get(c.referredUserId) ?? 'Filleul',
      amount: c.amount,
    }));
    const total = +lines.reduce((s, l) => s + l.amount, 0).toFixed(2);

    const pdf = await buildStatementPdf({
      ambassadorName: amb.name ?? amb.email,
      ambassadorEmail: amb.email,
      period,
      lines,
      total,
    });

    // Copie interne (hello@) + téléchargement côté ambassadeur.
    await this.resend
      .sendAmbassadorStatement({
        ambassadorName: amb.name ?? amb.email,
        ambassadorEmail: amb.email,
        period,
        pdf,
      })
      .catch(() => undefined);

    return { pdf, period, filename: `releve-commissions-${period}.pdf` };
  }
}
