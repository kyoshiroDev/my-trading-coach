import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { PublicService } from './public.service';

@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  /** Stats publiques (lecture seule, sans auth) — n'expose que le nombre de traders. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('stats')
  async getStats(): Promise<{ traders: number }> {
    return { traders: await this.publicService.getTradersCount() };
  }
}
