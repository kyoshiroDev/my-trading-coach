import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { AuthController } from './auth.controller';
import { ANON_THROTTLE_LIMIT, IP_THROTTLER } from '../../common/throttler/email-aware-throttler.guard';

/**
 * #1132 : POST /auth/refresh garde exprès la limite par défaut (60 / min / IP, compteur propre à la
 * route). Ni e-mail ni IA, pas de force brute possible (JWT signé), rejeu déjà coupé par la rotation
 * (#1002). Surtout : un 429 sur le refresh DÉCONNECTE l'utilisateur côté front (intercepteur
 * jwt-refresh) ; une limite plus serrée « par cohérence avec login » déconnecterait les traders
 * derrière une même IP (bureau, opérateur mobile). La route reste aussi comptée (jamais ignorée).
 */
describe('POST /auth/refresh — limite de débit (#1132)', () => {
  const handler = AuthController.prototype.refresh;
  // Comme le guard (`getAllAndOverride([handler, classe])`) : la méthode prime, sinon la classe.
  const meta = (key: string): unknown =>
    Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, AuthController);

  it('débit par défaut ou plus large, jamais plus serré (par défaut comme par IP)', () => {
    for (const name of ['default', IP_THROTTLER]) {
      const limit = meta(`THROTTLER:LIMIT${name}`) as number | undefined;
      if (limit === undefined) continue;
      const ttl = (meta(`THROTTLER:TTL${name}`) as number | undefined) ?? 60_000;
      // Débit comparé (requêtes par minute) : 60 / h passerait sinon pour « 60 ».
      expect((limit * 60_000) / ttl).toBeGreaterThanOrEqual(ANON_THROTTLE_LIMIT);
    }
  });

  it('jamais exclue du rate limiting', () => {
    expect(meta('THROTTLER:SKIPdefault')).toBeFalsy();
    expect(meta(`THROTTLER:SKIP${IP_THROTTLER}`)).toBeFalsy();
  });
});
