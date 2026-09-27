import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { CompleteOnboardingDto } from './dto/onboarding.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { AdminListQueryDto, AdminUpdateUserDto, SetRoleDto } from './dto/admin-user.dto';
import { DeprecatedRoute } from '../../common/decorators/deprecated-route.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: { id: string }) {
    return this.usersService.findById(user.id);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: { id: string }, @Body() dto: UpdateMeDto) {
    return this.usersService.updateMe(user.id, dto);
  }

  // Sauvegarde le profil (étape stratégie) sans terminer l'onboarding
  @Patch('onboarding')
  saveOnboardingProfile(
    @CurrentUser() user: { id: string },
    @Body() dto: CompleteOnboardingDto,
  ) {
    return this.usersService.saveOnboardingProfile(user.id, dto);
  }

  // Marque l'onboarding terminé : appelé uniquement à l'écran final
  @Patch('onboarding/finish')
  finishOnboarding(@CurrentUser() user: { id: string }) {
    return this.usersService.finishOnboarding(user.id);
  }

  @Patch('preferences')
  updatePreferences(
    @CurrentUser() user: { id: string },
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.usersService.updatePreferences(user.id, dto);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMe(
    @CurrentUser() user: { id: string },
    @Body() body?: { reason?: string },
  ) {
    await this.usersService.deleteMe(user.id, body?.reason);
  }

  // ── Anciennes routes admin : remplacées par /admin/users/* (AdminUsersController) ──
  // Gardées une version (déploiement front/back non simultané), puis à supprimer.

  // IMPORTANT : routes /admin/<literal> DOIVENT être avant /admin/:id
  @UseGuards(AdminGuard)
  @DeprecatedRoute('GET /admin/users/stats')
  @Get('admin/stats')
  adminStats() {
    return this.usersService.adminStats();
  }

  @UseGuards(AdminGuard)
  @DeprecatedRoute('GET /admin/users/online')
  @Get('admin/online')
  adminOnline() {
    return this.usersService.getOnlineUsers();
  }

  @UseGuards(AdminGuard)
  @DeprecatedRoute('GET /admin/users')
  @Get('admin')
  adminList(@Query() query: AdminListQueryDto) {
    return this.usersService.adminFindAll(
      query.page,
      query.limit,
      query.search,
    );
  }

  @UseGuards(AdminGuard)
  @DeprecatedRoute('PATCH /admin/users/:id')
  @Patch('admin/:id')
  adminUpdate(@Param('id') id: string, @Body() dto: AdminUpdateUserDto) {
    return this.usersService.adminUpdate(id, dto);
  }

  @UseGuards(AdminGuard)
  @DeprecatedRoute('PATCH /admin/users/:id/role')
  @Patch('admin/:id/role')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setRole(@Param('id') id: string, @Body() dto: SetRoleDto) {
    await this.usersService.setRole(id, dto.role);
  }

  @UseGuards(AdminGuard)
  @DeprecatedRoute('DELETE /admin/users/:id')
  @Delete('admin/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async adminDelete(@Param('id') id: string) {
    await this.usersService.adminDelete(id);
  }

  @UseGuards(AdminGuard)
  @DeprecatedRoute('GET /admin/users/subscriptions')
  @Get('admin/subscriptions')
  adminSubscriptions(@Query() query: AdminListQueryDto) {
    return this.usersService.adminSubscriptions(query.page, query.limit);
  }

  @UseGuards(AdminGuard)
  @DeprecatedRoute('GET /admin/users/:id')
  @Get('admin/:id/detail')
  adminDetail(@Param('id') id: string) {
    return this.usersService.adminDetail(id);
  }
}
