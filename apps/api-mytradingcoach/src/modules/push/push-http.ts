import { request as httpsRequest, type RequestOptions } from 'node:https';

/**
 * Requête vers un service push, BORNÉE (#717, revue I2). `web-push` ne pose qu'un délai
 * d'inactivité du socket (une réponse qui envoie un octet de temps en temps ne finit jamais) et lit
 * tout le corps en mémoire. Ici :
 * - délai TOTAL strict, de l'ouverture de la connexion à la fin : la requête est détruite au-delà ;
 * - corps de réponse lu au plus jusqu'au plafond, puis connexion coupée (seul le code HTTP sert) ;
 * - aucune redirection suivie (`https.request` n'en suit jamais : un 3xx est rendu tel quel).
 */

/** Délai total d'un envoi : un service push répond en quelques centaines de millisecondes. */
export const PUSH_DEADLINE_MS = 10_000;
/** Corps de réponse lu au plus (les services push renvoient quelques octets, ou rien). */
export const PUSH_MAX_RESPONSE_BYTES = 16 * 1024;

export interface PushHttpRequest {
  endpoint: string;
  method: string;
  headers: Record<string, string | number>;
  body: Buffer | null;
}

export interface PushHttpLimits {
  deadlineMs: number;
  maxResponseBytes: number;
  /** Tests seulement : autorité de certification d'un faux serveur local. */
  tls?: Pick<RequestOptions, 'ca'>;
}

/** Envoie et rend le code HTTP. Rejette si aucune réponse n'est arrivée avant l'échéance. */
export function postWithLimits(req: PushHttpRequest, limits: PushHttpLimits): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = new URL(req.endpoint);
    let status: number | null = null;
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const request = httpsRequest(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: req.method,
        headers: req.headers,
        ...limits.tls,
      },
      (res) => {
        status = res.statusCode ?? 0;
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > limits.maxResponseBytes) {
            settle(() => resolve(status as number));
            request.destroy();
          }
        });
        res.on('end', () => settle(() => resolve(status as number)));
      },
    );
    const timer = setTimeout(() => {
      request.destroy(new Error(`délai total de ${limits.deadlineMs} ms dépassé`));
    }, limits.deadlineMs);
    request.on('error', (err) => {
      // Code déjà reçu (corps trop long ou trop lent, coupé) : l'envoi a eu sa réponse.
      settle(() => (status !== null ? resolve(status) : reject(err)));
    });
    request.on('close', () => settle(() => (status !== null ? resolve(status) : reject(new Error('connexion fermée sans réponse')))));
    if (req.body) request.write(req.body);
    request.end();
  });
}
