import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AmbassadorGuard } from '../../common/guards/ambassador.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AmbassadorService } from './ambassador.service';

@Controller('ambassador')
@UseGuards(JwtAuthGuard, AmbassadorGuard)
export class AmbassadorController {
  constructor(private readonly service: AmbassadorService) {}

  @Get('stats')
  getStats(@CurrentUser() user: { id: string }) {
    return this.service.getStats(user.id);
  }
}
