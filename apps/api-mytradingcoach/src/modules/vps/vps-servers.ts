import { BadRequestException } from '@nestjs/common';

/**
 * Serveurs joignables en SSH par le module admin.
 * - `principal` : VPS_HOST (celui qui porte l'API : le VPS prod depuis la migration 2026-10-15),
 *   avec VPS_USER / VPS_SSH_KEY_B64. Toutes les actions.
 * - `secondaire` : VPS_SECONDARY_HOST, l'ancien VPS qui garde dev et beta. **Lecture seule**, avec sa
 *   propre clé restreinte (VPS_SECONDARY_USER / VPS_SECONDARY_SSH_KEY_B64), jamais celle du
 *   principal. Sans VPS_SECONDARY_SSH_KEY_B64, le secondaire n'est pas proposé.
 */
export const VPS_SERVER_IDS = ['principal', 'secondaire'] as const;
export type VpsServerId = (typeof VPS_SERVER_IDS)[number];

export interface VpsServer {
  id: VpsServerId;
  label: string;
  host: string;
  user: string;
  /** Clé privée SSH encodée en base64 (absente : principal non configuré). */
  keyB64?: string;
  /** Empreinte attendue de la clé d'hôte, au format de `ssh-keygen -lf` (`SHA256:…`). Optionnelle. */
  hostKeySha256?: string;
  /** Lecture seule : start / stop / restart / suppression / logs refusés avant tout appel SSH. */
  readOnly: boolean;
}

export function listVpsServers(env: NodeJS.ProcessEnv = process.env): VpsServer[] {
  const servers: VpsServer[] = [
    {
      id: 'principal',
      label: env['VPS_LABEL'] || 'VPS principal',
      host: env['VPS_HOST'] || '51.83.197.230',
      user: env['VPS_USER'] || 'greg',
      keyB64: env['VPS_SSH_KEY_B64'] || undefined,
      readOnly: false,
    },
  ];
  const secondaryHost = env['VPS_SECONDARY_HOST'];
  const secondaryKey = env['VPS_SECONDARY_SSH_KEY_B64'];
  if (secondaryHost && secondaryKey) {
    servers.push({
      id: 'secondaire',
      label: env['VPS_SECONDARY_LABEL'] || 'VPS secondaire',
      host: secondaryHost,
      user: env['VPS_SECONDARY_USER'] || 'mtc-monitor',
      keyB64: secondaryKey,
      hostKeySha256: env['VPS_SECONDARY_HOST_KEY_SHA256'] || undefined,
      readOnly: true,
    });
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
