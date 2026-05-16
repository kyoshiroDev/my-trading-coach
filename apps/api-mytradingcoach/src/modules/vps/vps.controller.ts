import {
  Controller, Delete, Get, Param, Post, Req, Res, UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { VpsService } from './vps.service';
import { DockerService } from './docker.service';
import { BackupService } from './backup.service';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller()
export class VpsController {
  constructor(
    private readonly vps: VpsService,
    private readonly docker: DockerService,
    private readonly backup: BackupService,
  ) {}

  @Get('vps/stats')
  async getStats() {
    return { data: await this.vps.getStats() };
  }

  @Get('docker/containers')
  async listContainers() {
    return { data: await this.docker.listContainers() };
  }

  @Post('docker/containers/:id/start')
  async startContainer(@Param('id') id: string) {
    return this.docker.containerAction(id, 'start');
  }

  @Post('docker/containers/:id/stop')
  async stopContainer(@Param('id') id: string) {
    return this.docker.containerAction(id, 'stop');
  }

  @Post('docker/containers/:id/restart')
  async restartContainer(@Param('id') id: string) {
    return this.docker.containerAction(id, 'restart');
  }

  @Delete('docker/containers/:id')
  async deleteContainer(@Param('id') id: string) {
    return this.docker.deleteContainer(id);
  }

  @Get('vps/backups')
  async listBackups() {
    return { data: await this.backup.listBackups() };
  }

  @Post('vps/backups')
  async createBackup() {
    return { data: await this.backup.createBackup() };
  }

  @Delete('vps/backups/:filename')
  async deleteBackup(@Param('filename') filename: string) {
    await this.backup.deleteBackup(filename);
    return { success: true };
  }

  @Get('vps/logs/:container')
  async streamLogs(
    @Param('container') container: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const ssh = await this.vps.getConnection();

    const containerName = container.replace(/[^a-zA-Z0-9_\-]/g, '');

    ssh.exec(`docker logs -f --tail 100 ${containerName}`, [], {
      onStdout: (chunk: Buffer) => {
        const lines = chunk.toString().split('\n');
        lines.forEach(line => {
          if (line) res.write(`data: ${line}\n\n`);
        });
      },
      onStderr: (chunk: Buffer) => {
        const lines = chunk.toString().split('\n');
        lines.forEach(line => {
          if (line) res.write(`data: ${line}\n\n`);
        });
      },
    }).catch(() => res.end());

    req.on('close', () => res.end());
  }
}
