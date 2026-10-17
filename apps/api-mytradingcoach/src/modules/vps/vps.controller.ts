import {
  Body, Controller, Delete, Get, Param, Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { SSHExecCommandOptions } from 'node-ssh';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { VpsService } from './vps.service';
import { DockerService } from './docker.service';
import { BackupService } from './backup.service';
import { CreateBackupDto } from './dto/create-backup.dto';
import { listVpsServers, resolveVpsServer } from './vps-servers';

/** Canal SSH d'une commande en cours (type de `ssh2`, exposé par node-ssh). */
type ClientChannel = Parameters<NonNullable<SSHExecCommandOptions['onChannel']>>[0];

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller()
export class VpsController {
  constructor(
    private readonly vps: VpsService,
    private readonly docker: DockerService,
    private readonly backup: BackupService,
  ) {}

  // Serveurs proposés par le sélecteur de la page Surveillance (sans l'IP : inutile au front).
  @Get('vps/servers')
  listServers() {
    return listVpsServers().map(({ id, label, readOnly }) => ({ id, label, readOnly }));
  }

  // `?server=principal|secondaire` sur les routes stats / docker / logs (absent = principal).
  @Get('vps/stats')
  async getStats(@Query('server') server?: string) {
    return await this.vps.getStats(resolveVpsServer(server).id);
  }

  @Get('docker/containers')
  async listContainers(@Query('server') server?: string) {
    return await this.docker.listContainers(resolveVpsServer(server).id);
  }

  @Post('docker/containers/:id/start')
  async startContainer(@Param('id') id: string, @Query('server') server?: string) {
    return this.docker.containerAction(id, 'start', resolveVpsServer(server).id);
  }

  @Post('docker/containers/:id/stop')
  async stopContainer(@Param('id') id: string, @Query('server') server?: string) {
    return this.docker.containerAction(id, 'stop', resolveVpsServer(server).id);
  }

  @Post('docker/containers/:id/restart')
  async restartContainer(@Param('id') id: string, @Query('server') server?: string) {
    return this.docker.containerAction(id, 'restart', resolveVpsServer(server).id);
  }

  @Delete('docker/containers/:id')
  async deleteContainer(@Param('id') id: string, @Query('server') server?: string) {
    return this.docker.deleteContainer(id, resolveVpsServer(server).id);
  }

  @Get('vps/backups')
  async listBackups() {
    return await this.backup.listBackups();
  }

  @Post('vps/backups')
  async createBackup(@Body() body: CreateBackupDto) {
    return await this.backup.createBackup(body?.target);
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
    @Query('server') server?: string,
  ) {
    // Validé avant les en-têtes SSE pour renvoyer un vrai 400 / 403 / 503 : `docker logs` n'est
    // pas dans les commandes autorisées du secondaire (lecture seule), et une connexion
    // impossible doit sortir en erreur HTTP, pas en flux vide.
    const serverId = resolveVpsServer(server).id;
    this.docker.assertFullAccess(serverId);
    const containerName = this.docker.logsContainerName(container);
    const ssh = await this.vps.getConnection(serverId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Onglet fermé : on arrête `docker logs -f` et on ferme le canal SSH, sinon la commande et le
    // canal restent ouverts sur le serveur jusqu'à la prochaine ligne de log.
    let channel: ClientChannel | undefined;
    let closed = false;
    const stop = (ch: ClientChannel) => {
      ch.signal('TERM');
      ch.close();
    };

    ssh.exec(`docker logs -f --tail 100 ${containerName}`, [], {
      onChannel: (ch: ClientChannel) => {
        channel = ch;
        if (closed) stop(ch);
      },
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

    req.on('close', () => {
      closed = true;
      if (channel) stop(channel);
      res.end();
    });
  }
}
