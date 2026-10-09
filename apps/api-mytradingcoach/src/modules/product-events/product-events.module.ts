import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProductEventsController } from './product-events.controller';
import { ProductEventsService } from './product-events.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProductEventsController],
  providers: [ProductEventsService],
  exports: [ProductEventsService],
})
export class ProductEventsModule {}
