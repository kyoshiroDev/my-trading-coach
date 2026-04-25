import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, UseGuards } from '@nestjs/common';
import { IsEnum } from 'class-validator';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { CompleteOnboardingDto } from './dto/onboarding.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

class SetRoleDto {
  @IsEnum(Role)
  role!: Role;
}

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

  @Patch('onboarding')
  completeOnboarding(@CurrentUser() user: { id: string }, @Body() dto: CompleteOnboardingDto) {
    return this.usersService.completeOnboarding(user.id, dto);
  }

  @Patch('preferences')
  updatePreferences(@CurrentUser() user: { id: string }, @Body() dto: UpdatePreferencesDto) {
    return this.usersService.updatePreferences(user.id, dto);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMe(@CurrentUser() user: { id: string }) {
    await this.usersService.deleteMe(user.id);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/:id/role')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setRole(@Param('id') id: string, @Body() dto: SetRoleDto) {
    await this.usersService.setRole(id, dto.role);
  }
}
