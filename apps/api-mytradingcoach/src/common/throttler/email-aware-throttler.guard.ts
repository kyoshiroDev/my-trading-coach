import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { loadTestTracker } from './load-test-tracker';

/**
 * Second throttler, compté par **IP seule** (SCA-B0-04). La clé IP + compte ci-dessous se
 * contourne en changeant d'e-mail à chaque requête : une IP pouvait créer des comptes sans fin
 * (un hash argon2 et deux e-mails par inscription). Ce throttler borne le total par IP.
 *
 * Neutre par défaut (limite `IP_THROTTLER_OFF`, jamais compté, donc aucun aller-retour Redis de
 * plus) ; il ne s'active que sur les routes qui le resserrent avec `@Throttle({ ip: … })`.
 */
export const IP_THROTTLER = 'ip';
export const IP_THROTTLER_OFF = Number.MAX_SAFE_INTEGER;

/**
 * Rate limiting compté par **IP + compte visé**, et non par IP seule.
 *
 * Pourquoi : sur les routes d'authentification, l'IP seule protège mal dans les deux sens.
 * Plusieurs personnes derrière un même NAT (entreprise, université, opérateur mobile) partagent
 * un compteur et se bloquent mutuellement ; à l'inverse, une attaque distribuée sur UN compte
 * obtient la limite entière depuis chaque IP sans jamais la déclencher. Ajouter le compte visé
 * à la clé rend la limite significative pour ce compte, quelle que soit l'origine.
 *
 * L'email n'est jamais stocké en clair : la clé part dans Redis, et un compteur de rate limiting
 * n'a pas besoin de connaître l'adresse — seulement de la distinguer. On en garde donc une
 * empreinte tronquée, suffisante pour séparer les comptes sans conserver de donnée personnelle.
 *
 * Les requêtes sans email (la grande majorité) gardent exactement le comportement d'avant :
 * la clé est l'IP.
 */
@Injectable()
export class EmailAwareThrottlerGuard extends ThrottlerGuard {
  protected override async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    if (props.throttler.name !== IP_THROTTLER) return super.handleRequest(props);
    if (props.limit >= IP_THROTTLER_OFF) return true; // route sans limite par IP : rien à compter
    return super.handleRequest({ ...props, getTracker: (req) => this.clientTracker(req) });
  }

  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const ip = await this.clientTracker(req);
    const account = accountFingerprint(req);
    return account ? `${ip}:${account}` : ip;
  }

  /** IP du client, ou client virtuel d'un test de charge autorisé (voir load-test-tracker.ts). */
  private async clientTracker(req: Record<string, unknown>): Promise<string> {
    return loadTestTracker(req) ?? ThrottlerGuard.prototype['getTracker'].call(this, req);
  }
}

/**
 * Empreinte du compte visé par la requête, ou `null` si la requête n'en désigne aucun.
 *
 * Normalisée avant l'empreinte, sinon `Greg@Mail.com ` et `greg@mail.com` tomberaient dans deux
 * compteurs distincts — et la limite se contournerait en changeant la casse.
 */
function accountFingerprint(req: Record<string, unknown>): string | null {
  const body = req['body'];
  if (typeof body !== 'object' || body === null) return null;
  const raw = (body as Record<string, unknown>)['email'];
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email === '') return null;
  return createHash('sha256').update(email).digest('hex').slice(0, 16);
}
