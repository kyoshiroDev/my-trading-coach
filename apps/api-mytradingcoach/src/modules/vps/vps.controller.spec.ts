import { BadRequestException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { BackupService } from './backup.service';
import { DockerService } from './docker.service';
import { VpsController } from './vps.controller';
import type { VpsService } from './vps.service';

type ExecOptions = { onChannel?: (ch: unknown) => void };

/** Flux de logs avec une connexion SSH factice : commande envoyée, options et canal. */
function setup() {
  const channel = { signal: vi.fn(), close: vi.fn() };
  const exec = vi.fn((_cmd: string, _params: string[], _opts: ExecOptions) => new Promise<string>(() => undefined));
  const vps = { getConnection: vi.fn(async () => ({ exec })) } as unknown as VpsService;
  const controller = new VpsController(vps, new DockerService(vps), {} as BackupService);
  const listeners: Record<string, () => void> = {};
  const req = { on: vi.fn((ev: string, cb: () => void) => { listeners[ev] = cb; }) } as unknown as Request;
  const res = { setHeader: vi.fn(), flushHeaders: vi.fn(), write: vi.fn(), end: vi.fn() };
  const open = (name: string) => controller.streamLogs(name, req, res as unknown as Response);
  return { channel, exec, vps, res, open, closeTab: () => listeners['close']?.() };
}

describe('VpsController.streamLogs', () => {
  beforeEach(() => vi.stubEnv('VPS_SECONDARY_HOST', ''));
  afterEach(() => vi.unstubAllEnvs());

  it('envoie docker logs avec le nom du container', async () => {
    const { exec, open } = setup();
    await open('mtc_api_prod_blue');
    expect(exec.mock.calls[0][0]).toBe('docker logs -f --tail 100 mtc_api_prod_blue');
  });

  it.each(['', '-x', '--help', '_api', 'api;id', 'api id', 'api.prod', 'a'.repeat(129)])(
    'nom refusé (%j) : 400 avant toute connexion SSH',
    async (name) => {
      const { vps, res, open } = setup();
      await expect(open(name)).rejects.toBeInstanceOf(BadRequestException);
      expect(vps.getConnection).not.toHaveBeenCalled();
      expect(res.flushHeaders).not.toHaveBeenCalled();
    },
  );

  it('onglet fermé : docker logs arrêté et canal SSH fermé', async () => {
    const { channel, exec, res, open, closeTab } = setup();
    await open('mtc_api_prod_blue');
    exec.mock.calls[0][2].onChannel?.(channel);
    closeTab();
    expect(channel.signal).toHaveBeenCalledWith('TERM');
    expect(channel.close).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
  });

  it('onglet fermé avant l’ouverture du canal : le canal est fermé dès qu’il arrive', async () => {
    const { channel, exec, open, closeTab } = setup();
    await open('mtc_api_prod_blue');
    closeTab();
    expect(channel.close).not.toHaveBeenCalled();
    exec.mock.calls[0][2].onChannel?.(channel);
    expect(channel.signal).toHaveBeenCalledWith('TERM');
    expect(channel.close).toHaveBeenCalled();
  });
});
