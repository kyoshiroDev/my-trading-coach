import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DemoAllowed } from '../../common/decorators/demo-allowed.decorator';
import { ProductEventDto } from './dto/product-event.dto';
import { ProductEventsService } from './product-events.service';

@Controller('events')
export class ProductEventsController {
  constructor(private readonly events: ProductEventsService) {}

  /** Entonnoir Premium. Autorisé en démo : on mesure aussi ce que les visiteurs y font. */
  @Post()
  @HttpCode(204)
  @DemoAllowed()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async record(@CurrentUser() user: { id: string }, @Body() dto: ProductEventDto): Promise<void> {
    await this.events.record(user.id, dto.event, dto.place ?? '');
  }
}
