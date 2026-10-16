import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { listVpsServers, resolveVpsServer } from './vps-servers';
import { DockerService } from './docker.service';
import type { VpsService } from './vps.service';

const PROD_ENV = {
  VPS_HOST: '149.202.40.240',
  VPS_LABEL: 'VPS prod',
  VPS_SECONDARY_HOST: '51.83.197.230',
  VPS_SECONDARY_LABEL: 'VPS dev · beta',
};

describe('listVpsServers', () => {
  it('ne propose que le principal sans VPS_SECONDARY_HOST', () => {
    expect(listVpsServers({ VPS_HOST: '149.202.40.240' })).toEqual([
      { id: 'principal', label: 'VPS principal', host: '149.202.40.240' },
    ]);
  });

  it('ajoute le secondaire quand il est configuré', () => {
    expect(listVpsServers(PROD_ENV)).toEqual([
      { id: 'principal', label: 'VPS prod', host: '149.202.40.240' },
      { id: 'secondaire', label: 'VPS dev · beta', host: '51.83.197.230' },
    ]);
  });
});

describe('resolveVpsServer', () => {
  it('prend le principal par défaut', () => {
    expect(resolveVpsServer(undefined, PROD_ENV).host).toBe('149.202.40.240');
  });

  it('résout le secondaire', () => {
    expect(resolveVpsServer('secondaire', PROD_ENV).host).toBe('51.83.197.230');
  });

  it('refuse un secondaire non configuré et un serveur inconnu', () => {
    expect(() => resolveVpsServer('secondaire', { VPS_HOST: 'x' })).toThrow(BadRequestException);
    expect(() => resolveVpsServer('autre', PROD_ENV)).toThrow(BadRequestException);
  });
});

describe('DockerService · actions', () => {
  const setup = () => {
    const exec = vi.fn().mockResolvedValue('');
    return { exec, docker: new DockerService({ exec } as unknown as VpsService) };
  };

  it('envoie la commande au serveur demandé', async () => {
    const { exec, docker } = setup();
    await docker.containerAction('mtc_api_dev_blue', 'restart', 'secondaire');
    expect(exec).toHaveBeenCalledWith('docker restart mtc_api_dev_blue', 'secondaire');
  });

  it('refuse un id qui pourrait injecter une commande', async () => {
    const { exec, docker } = setup();
    await expect(docker.containerAction('x; rm -rf /', 'stop')).rejects.toThrow(BadRequestException);
    await expect(docker.deleteContainer('$(id)')).rejects.toThrow(BadRequestException);
    expect(exec).not.toHaveBeenCalled();
  });
});
