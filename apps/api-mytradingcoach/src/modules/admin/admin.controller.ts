import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AdminService } from './admin.service';
import { AnthropicCostService } from './anthropic-cost.service';
import { EmailCampaignService } from './email-campaign.service';
import type { CampaignType } from './email-campaign.service';
import { MetricsSnapshotCron } from './metrics-snapshot.cron';
import { DeletedAccountService } from './deleted-account.service';
import { DemoSeedService } from './demo-seed.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DiscordService } from '../discord/discord.service';
import { CampaignContentDto, SendCampaignDto } from './dto/campaign.dto';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly anthropicCost: AnthropicCostService,
    private readonly emailCampaign: EmailCampaignService,
    private readonly discordService: DiscordService,
    private readonly metrics: MetricsSnapshotCron,
    private readonly deletedAccounts: DeletedAccountService,
    private readonly demoSeed: DemoSeedService,
  ) {}

  /** Comptes supprimés (trace analytique RGPD) : liste récente + agrégats. */
  @Get('deleted-accounts')
  getDeletedAccounts() {
    return this.deletedAccounts.getDeletedAccounts();
  }

  /** Seed/refresh idempotent du compte démo vitrine. Admin only. */
  @Post('seed-demo')
  seedDemo() {
    return this.demoSeed.run();
  }

  // ── Métriques historisées (snapshots quotidiens) ──────────────────────────

  /** Série d'évolution (date, users, mrr) sur N jours (snapshots persistés). */
  @Get('metrics/history')
  metricsHistory(@Query('days') days?: string) {
    return this.metrics.historyPoints(days ? parseInt(days, 10) : 30);
  }

  /** Déclenche un snapshot immédiat (backfill / test). Idempotent sur la date. */
  @Post('metrics/snapshot')
  triggerSnapshot() {
    return this.metrics.takeSnapshot();
  }

  /** Historique de santé VPS (uptime 90j) : points réellement enregistrés par le cron. */
  @Get('health-history')
  healthHistory(@Query('days') days?: string) {
    return this.metrics.healthHistory(days ? parseInt(days, 10) : 90);
  }

  /**
   * Re-synchronise le rôle Discord de tous les comptes liés (idempotent).
   * Réaligne le rôle Membre/Premium sur isPremiumAccess après un changement de plan.
   */
  @Post('discord/resync')
  async resyncDiscordRoles() {
    const users = await this.adminService.findDiscordLinkedUserIds();
    let ok = 0;
    for (const u of users) {
      try {
        await this.discordService.syncDiscordRole(u.id);
        ok++;
      } catch {
        // continue : un échec ponctuel ne doit pas bloquer le batch
      }
    }
    return { linked: users.length, resynced: ok };
  }


  // Usage IA 30j : coût réel (Cost API) + attribution estimée (logs) + réconciliation.
  @Get('ai-cost')
  getAiCost() {
    return this.adminService.getAiCost();
  }

  // Rafraîchit le cache du coût réel sans attendre le cron de 6h (1er remplissage / refresh manuel).
  @Post('ai-cost/refresh')
  async refreshAiCost() {
    const { rows, total30d } = await this.anthropicCost.refreshLast30Days();
    return { ok: true, rows, total30d };
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
    @Body() body: CampaignContentDto,
  ) {
    return this.emailCampaign.preview(type, body.subject, body.content);
  }

  @Post('campaigns/:type/send')
  sendCampaign(
    @Param('type') type: CampaignType,
    @Body() body: SendCampaignDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.emailCampaign.send(type, user.id, body.subject, body.content, body.force === true);
  }

  @Get('referral-stats')
  getReferralStats() {
    return this.adminService.getReferralStats();
  }

  @Patch('referral-commission/:id/pay')
  markCommissionPaid(@Param('id') id: string) {
    return this.adminService.markCommissionPaid(id);
  }
}
