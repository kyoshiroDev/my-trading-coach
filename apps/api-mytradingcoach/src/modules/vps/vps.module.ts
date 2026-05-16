import { Module } from '@nestjs/common';
import { VpsController } from './vps.controller';
import { VpsService } from './vps.service';
import { DockerService } from './docker.service';
import { BackupService } from './backup.service';

@Module({
  controllers: [VpsController],
  providers: [VpsService, DockerService, BackupService],
  exports: [VpsService],
})
export class VpsModule {}
