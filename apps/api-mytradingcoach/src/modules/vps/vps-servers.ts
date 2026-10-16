import { BadRequestException } from '@nestjs/common';

/**
 * Serveurs joignables en SSH par le module admin.
 * - `principal` : VPS_HOST (celui qui porte l'API : le VPS prod depuis la migration 2026-10-15).
 * - `secondaire` : VPS_SECONDARY_HOST, optionnel (l'ancien VPS qui garde dev et beta).
 * Même utilisateur et même clé (VPS_USER / VPS_SSH_KEY_B64) pour les deux.
 */
export const VPS_SERVER_IDS = ['principal', 'secondaire'] as const;
export type VpsServerId = (typeof VPS_SERVER_IDS)[number];

export interface VpsServer {
  id: VpsServerId;
  label: string;
  host: string;
}

export function listVpsServers(env: NodeJS.ProcessEnv = process.env): VpsServer[] {
  const servers: VpsServer[] = [
    { id: 'principal', label: env['VPS_LABEL'] || 'VPS principal', host: env['VPS_HOST'] || '51.83.197.230' },
  ];
  const secondary = env['VPS_SECONDARY_HOST'];
  if (secondary) {
    servers.push({ id: 'secondaire', label: env['VPS_SECONDARY_LABEL'] || 'VPS secondaire', host: secondary });
  }
  return servers;
}

/** Valide le paramètre `?server=` (absent = principal) ; refuse un serveur non configuré. */
export function resolveVpsServer(raw: string | undefined, env: NodeJS.ProcessEnv = process.env): VpsServer {
  const id = raw || 'principal';
  const server = listVpsServers(env).find(s => s.id === id);
  if (!server) throw new BadRequestException(`Serveur inconnu ou non configuré : ${id}`);
  return server;
}
