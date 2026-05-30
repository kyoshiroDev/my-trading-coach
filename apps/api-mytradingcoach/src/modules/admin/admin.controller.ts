import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AdminService } from './admin.service';
import { EmailCampaignService, CampaignType } from './email-campaign.service';
import { UsersService } from '../users/users.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly emailCampaign: EmailCampaignService,
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
  ) {}

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
