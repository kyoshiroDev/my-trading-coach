import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listVpsServers, resolveVpsServer } from './vps-servers';
import { DockerService } from './docker.service';
import type { VpsService } from './vps.service';

const PROD_ENV = {
  VPS_HOST: '149.202.40.240',
  VPS_LABEL: 'VPS prod',
  VPS_SSH_KEY_B64: 'cHJpbmNpcGFs',
  VPS_SECONDARY_HOST: '51.83.197.230',
  VPS_SECONDARY_LABEL: 'VPS dev · beta',
  VPS_SECONDARY_SSH_KEY_B64: 'c2Vjb25kYWlyZQ==',
};

describe('listVpsServers', () => {
  it('ne propose que le principal sans VPS_SECONDARY_HOST', () => {
    expect(listVpsServers({ VPS_HOST: '149.202.40.240' })).toEqual([
      { id: 'principal', label: 'VPS principal', host: '149.202.40.240', user: 'greg', keyB64: undefined, readOnly: false },
    ]);
  });

  it('ajoute le secondaire, en lecture seule et avec sa propre clé', () => {
    const [principal, secondaire] = listVpsServers({ ...PROD_ENV, VPS_SECONDARY_HOST_KEY_SHA256: 'SHA256:abc' });
    expect(principal).toMatchObject({ id: 'principal', label: 'VPS prod', keyB64: 'cHJpbmNpcGFs', readOnly: false });
    expect(secondaire).toEqual({
      id: 'secondaire', label: 'VPS dev · beta', host: '51.83.197.230', user: 'mtc-monitor',
      keyB64: 'c2Vjb25kYWlyZQ==', hostKeySha256: 'SHA256:abc', readOnly: true,
    });
  });

  it('sans clé dédiée, pas de secondaire (jamais de repli sur la clé du principal)', () => {
    const { VPS_SECONDARY_SSH_KEY_B64: _, ...sansCle } = PROD_ENV;
    expect(listVpsServers(sansCle).map(s => s.id)).toEqual(['principal']);
  });

  it('utilisateur du secondaire configurable', () => {
    expect(listVpsServers({ ...PROD_ENV, VPS_SECONDARY_USER: 'autre' })[1].user).toBe('autre');
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
  beforeEach(() => {
    for (const [k, v] of Object.entries(PROD_ENV)) vi.stubEnv(k, v);
  });
  afterEach(() => vi.unstubAllEnvs());

  const setup = () => {
    const exec = vi.fn().mockResolvedValue('');
    return { exec, docker: new DockerService({ exec } as unknown as VpsService) };
  };

  it('envoie la commande au principal', async () => {
    const { exec, docker } = setup();
    await docker.containerAction('mtc_api_prod_blue', 'restart', 'principal');
    expect(exec).toHaveBeenCalledWith('docker restart mtc_api_prod_blue', 'principal');
  });

  it.each(['start', 'stop', 'restart'] as const)('secondaire : %s refusé en 403 sans appel SSH', async (action) => {
    const { exec, docker } = setup();
    await expect(docker.containerAction('mtc_api_dev_blue', action, 'secondaire')).rejects.toThrow(ForbiddenException);
    expect(exec).not.toHaveBeenCalled();
  });

  it('secondaire : suppression refusée en 403 sans appel SSH', async () => {
    const { exec, docker } = setup();
    await expect(docker.deleteContainer('mtc_api_dev_blue', 'secondaire')).rejects.toThrow(ForbiddenException);
    expect(exec).not.toHaveBeenCalled();
  });

  it('une commande en échec remonte en erreur, pas en succès', async () => {
    const exec = vi.fn().mockRejectedValue(new Error('code 126'));
    const docker = new DockerService({ exec } as unknown as VpsService);
    await expect(docker.containerAction('mtc_api_prod_blue', 'stop', 'principal')).rejects.toThrow('code 126');
  });

  it('refuse un id qui pourrait injecter une commande', async () => {
    const { exec, docker } = setup();
    await expect(docker.containerAction('x; rm -rf /', 'stop')).rejects.toThrow(BadRequestException);
    await expect(docker.deleteContainer('$(id)')).rejects.toThrow(BadRequestException);
    expect(exec).not.toHaveBeenCalled();
  });
});
