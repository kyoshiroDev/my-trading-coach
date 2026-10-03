import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { UsersService } from '../users/users.service';
import { AdminListQueryDto, AdminUpdateUserDto, OfferPremiumDto, SetRoleDto } from '../users/dto/admin-user.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserDetailService } from './user-detail.service';

/**
 * Gestion des utilisateurs par l'admin : `/admin/users/*`.
 * Guard au niveau de la classe : une nouvelle route est protégée sans rien ajouter.
 * Ordre : les routes littérales (`stats`, `online`, `subscriptions`) AVANT `:id`.
 */
@Controller('admin/users')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminUsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly userDetail: UserDetailService,
  ) {}

  @Get()
  list(@Query() query: AdminListQueryDto) {
    return this.usersService.adminFindAll(query.page, query.limit, query.search);
  }

  /** KPIs globaux (MRR, inscrits, essais…). */
  @Get('stats')
  stats() {
    return this.usersService.adminStats();
  }

  @Get('online')
  online() {
    return this.usersService.getOnlineUsers();
  }

  @Get('subscriptions')
  subscriptions(@Query() query: AdminListQueryDto) {
    return this.usersService.adminSubscriptions(query.page, query.limit);
  }

  /** Fiche utilisateur détaillée (faits bruts agrégés). */
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.userDetail.getUserDetail(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: AdminUpdateUserDto) {
    return this.usersService.adminUpdate(id, dto);
  }

  @Patch(':id/role')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setRole(@Param('id') id: string, @Body() dto: SetRoleDto) {
    await this.usersService.setRole(id, dto.role);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.usersService.adminDelete(id);
  }

  /** Offre N jours de Premium (défaut 30) sans abonnement Stripe ; prolonge un mois en cours. */
  @Post(':id/offer-premium')
  @HttpCode(HttpStatus.OK)
  offerPremium(
    @Param('id') id: string,
    @Body() dto: OfferPremiumDto,
    @CurrentUser() admin: { id: string },
  ) {
    return this.usersService.offerPremium(id, dto.days, admin.id);
  }

  @Post(':id/beta')
  async assignBetaRole(@Param('id') id: string) {
    await this.usersService.setRole(id, 'BETA_TESTER');
    return { id, role: 'BETA_TESTER' };
  }

  @Delete(':id/beta')
  async removeBetaRole(@Param('id') id: string) {
    await this.usersService.setRole(id, 'USER');
    return { id, role: 'USER' };
  }
}
