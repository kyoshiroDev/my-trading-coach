import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AmbassadorController } from './ambassador.controller';
import { AmbassadorService } from './ambassador.service';

@Module({
  imports: [PrismaModule],
  controllers: [AmbassadorController],
  providers: [AmbassadorService],
  // Exporté pour UsersService : l'édition de rôle admin doit passer par
  // promote()/revoke() afin qu'un AMBASSADOR ait toujours un referralCode.
  exports: [AmbassadorService],
})
export class AmbassadorModule {}
