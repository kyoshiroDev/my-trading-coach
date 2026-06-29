import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SetupsService } from './setups.service';
import { CreateSetupDto } from './dto/create-setup.dto';
import { UpdateSetupDto } from './dto/update-setup.dto';

@Controller('setups')
@UseGuards(JwtAuthGuard)
export class SetupsController {
  constructor(private readonly setups: SetupsService) {}

  @Get()
  list(@CurrentUser() user: { id: string }) {
    return this.setups.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateSetupDto) {
    return this.setups.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateSetupDto,
  ) {
    return this.setups.update(user.id, id, dto);
  }

  @Patch(':id/archive')
  archive(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.setups.archive(user.id, id);
  }

  @Patch(':id/restore')
  restore(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.setups.restore(user.id, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.setups.remove(user.id, id);
  }
}
