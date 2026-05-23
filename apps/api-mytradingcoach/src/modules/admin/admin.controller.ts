import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AdminService } from './admin.service';
import { EmailCampaignService, CampaignType } from './email-campaign.service';
import { UsersService } from '../users/users.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly emailCampaign: EmailCampaignService,
    private readonly usersService: UsersService,
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
}
