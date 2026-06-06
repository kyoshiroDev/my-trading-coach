import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AdminService } from './admin.service';
import { EmailCampaignService } from './email-campaign.service';
import type { CampaignType } from './email-campaign.service';
import { MetricsSnapshotCron } from './metrics-snapshot.cron';
import { UsersService } from '../users/users.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { DiscordService } from '../discord/discord.service';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly emailCampaign: EmailCampaignService,
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
    private readonly discordService: DiscordService,
    private readonly metrics: MetricsSnapshotCron,
  ) {}

  // ── Métriques historisées (snapshots quotidiens) ──────────────────────────

  /** Les N derniers snapshots quotidiens (pour les courbes d'évolution). */
  @Get('metrics/history')
  metricsHistory(@Query('days') days?: string) {
    return this.metrics.history(days ? parseInt(days, 10) : 30);
  }

  /** Déclenche un snapshot immédiat (backfill / test). Idempotent sur la date. */
  @Post('metrics/snapshot')
  triggerSnapshot() {
    return this.metrics.takeSnapshot();
  }

  /**
   * Re-synchronise le rôle Discord de tous les comptes liés (idempotent).
   * Corrige les STARTER existants qui avaient le rôle Membre avant le fix isPremiumAccess.
   */
  @Post('discord/resync')
  async resyncDiscordRoles() {
    const users = await this.prisma.user.findMany({
      where: { discordId: { not: null } },
      select: { id: true },
    });
    let ok = 0;
    for (const u of users) {
      try {
        await this.discordService.syncDiscordRole(u.id);
        ok++;
      } catch {
        // continue — un échec ponctuel ne doit pas bloquer le batch
      }
    }
    return { linked: users.length, resynced: ok };
  }

  @Post('users/:id/beta')
  async assignBetaRole(@Param('id') id: string) {
    await this.usersService.setRole(id, 'BETA_TESTER');
    return { id, role: 'BETA_TESTER' };
  }

  @Delete('users/:id/beta')
  async removeBetaRole(@Param('id') id: string) {
    await this.usersService.setRole(id, 'USER');
    return { id, role: 'USER' };
  }

  @Get('ai-usage')
  async getAiUsage() {
    return this.adminService.getAiUsage();
  }

  @Get('retention')
  async getRetention() {
    return this.adminService.getRetention();
  }

  @Get('stripe/reconcile')
  async reconcileStripe() {
    return this.adminService.reconcileStripe();
  }

  @Get('campaigns')
  listCampaigns() {
    return this.emailCampaign.listCampaigns();
  }

  @Post('campaigns/:type/preview')
  previewCampaign(
    @Param('type') type: CampaignType,
    @Body() body: { subject?: string; content?: string },
  ) {
    return this.emailCampaign.preview(type, body.subject, body.content);
  }

  @Post('campaigns/:type/send')
  sendCampaign(
    @Param('type') type: CampaignType,
    @Body() body: { subject?: string; content?: string },
    @CurrentUser() user: { id: string },
  ) {
    return this.emailCampaign.send(type, user.id, body.subject, body.content);
  }

  @Get('referral-stats')
  async getReferralStats() {
    const ambassadors = await this.prisma.user.findMany({
      where: { referralCode: { not: null } },
      select: {
        id: true,
        name: true,
        email: true,
        referralCode: true,
        referrals: {
          select: {
            amount: true,
            status: true,
            period: true,
            referredUserId: true,
          },
        },
      },
    });

    return {
      data: ambassadors.map((a) => ({
        name: a.name,
        email: a.email,
        referralCode: a.referralCode,
        totalReferrals: new Set(a.referrals.map((r) => r.referredUserId)).size,
        totalCommissions: a.referrals.reduce((s, r) => s + r.amount, 0).toFixed(2),
        pendingCommissions: a.referrals
          .filter((r) => r.status === 'pending')
          .reduce((s, r) => s + r.amount, 0)
          .toFixed(2),
        commissionsByMonth: a.referrals.reduce(
          (acc, r) => {
            acc[r.period] = (acc[r.period] ?? 0) + r.amount;
            return acc;
          },
          {} as Record<string, number>,
        ),
      })),
    };
  }

  @Patch('referral-commission/:id/pay')
  markCommissionPaid(@Param('id') id: string) {
    return this.prisma.referralCommission.update({
      where: { id },
      data: { status: 'paid' },
    });
  }
}
