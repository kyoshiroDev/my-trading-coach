import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserAssetsService } from './user-assets.service';
import { InstrumentsService } from './instruments.service';
import { SaveUserAssetsDto, SetFavoriteAssetDto } from './dto/user-assets.dto';

/** Instruments tradables et actifs suivis par l'utilisateur : `/instruments/*`. */
@UseGuards(JwtAuthGuard)
@Controller('instruments')
export class InstrumentsController {
  constructor(
    private readonly instruments: InstrumentsService,
    private readonly userAssets: UserAssetsService,
  ) {}

  @Get()
  list() {
    return this.instruments.list();
  }

  @Get('search')
  search(@Query('q') q: string) {
    return this.instruments.search(q);
  }

  @Get('user-assets')
  getUserAssets(@CurrentUser() user: { id: string }) {
    return this.userAssets.getUserAssets(user.id);
  }

  @Patch('user-assets')
  async saveUserAssets(@CurrentUser() user: { id: string }, @Body() body: SaveUserAssetsDto) {
    await this.userAssets.saveUserAssets(user.id, body.assets ?? [], body.favoriteAsset);
    return { saved: true };
  }

  @Patch('favorite-asset')
  setFavoriteAsset(@CurrentUser() user: { id: string }, @Body() body: SetFavoriteAssetDto) {
    return this.userAssets.setFavoriteAsset(user.id, body.asset ?? null);
  }
}
