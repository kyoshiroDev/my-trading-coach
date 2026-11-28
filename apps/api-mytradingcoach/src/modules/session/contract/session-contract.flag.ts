import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';

/** Contrat de session (#667) : `SESSION_CONTRACT_ENABLED=true` seulement (éteint par défaut). */
export const sessionContractEnabled = () => process.env['SESSION_CONTRACT_ENABLED'] === 'true';

/** Routes du contrat : 404 tant que l'interrupteur est éteint. */
@Injectable()
export class SessionContractGuard implements CanActivate {
  canActivate(): boolean {
    if (!sessionContractEnabled()) throw new NotFoundException();
    return true;
  }
}
